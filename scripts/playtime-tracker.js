const MODULE_ID = "playtime-tracker";
const SETTINGS_KEY = "playtimes";
const COMMANDS = ["played", "playtime"];

let updateTimer = null;
let trackerDialog = null;

/* ==========================================================================
   UTILITY
   ========================================================================== */

function isPrimaryGM() {
  return game.user?.isGM && game.users.activeGM?.id === game.user.id;
}

function localize(key, fallback = key) {
  const translated = game.i18n.localize(key);

  /*
   * Foundry returns the key itself when the translation does not exist.
   * Prevent that raw key from ever being displayed.
   */
  return translated === key ? fallback : translated;
}

function getPlaytimes() {
  return foundry.utils.duplicate(
    game.settings.get(
      MODULE_ID,
      SETTINGS_KEY
    ) ?? {}
  );
}

function createEntry() {
  return {
    total: 0,
    startTime: null
  };
}

function getEntry(playtimes, userId) {
  if (!playtimes[userId]) {
    playtimes[userId] = createEntry();
  }

  return playtimes[userId];
}

function getCurrentPlaytime(
  user,
  entry,
  now = Date.now()
) {
  const total =
    Number(entry?.total) || 0;

  if (
    !user.active ||
    !entry?.startTime
  ) {
    return total;
  }

  return (
    total +
    Math.max(
      0,
      now - entry.startTime
    )
  );
}

async function savePlaytimes(playtimes) {
  if (!isPrimaryGM()) {
    console.warn(
      `${MODULE_ID} | Current user is not the primary GM.`
    );

    return false;
  }

  try {
    await game.settings.set(
      MODULE_ID,
      SETTINGS_KEY,
      playtimes
    );

    return true;
  } catch (error) {
    console.error(
      `${MODULE_ID} | Failed to save playtime data.`,
      error
    );

    ui.notifications.error(
      localize(
        "PLAYTIME-TRACKER.error.save",
        "Unable to save playtime data."
      )
    );

    return false;
  }
}

/* ==========================================================================
   INIT
   ========================================================================== */

Hooks.once("init", () => {
  game.settings.register(
    MODULE_ID,
    SETTINGS_KEY,
    {
      name: "Playtime Data",
      hint: "Internal playtime tracking data.",
      scope: "world",
      config: false,
      type: Object,
      default: {}
    }
  );

  registerChatCommands();

  console.log(
    `${MODULE_ID} | Initialized.`
  );
});

/* ==========================================================================
   READY
   ========================================================================== */

Hooks.once("ready", async () => {
  if (!game.user.isGM) {
    return;
  }

  if (!isPrimaryGM()) {
    return;
  }

  await initializeActiveUsers();

  updateTimer = window.setInterval(
    checkpointActiveUsers,
    5 * 60 * 1000
  );

  console.log(
    `${MODULE_ID} | Primary GM tracker active.`
  );
});

/* ==========================================================================
   CHAT COMMANDS
   ========================================================================== */

function registerChatCommands() {
  const ChatLog =
    foundry.applications.sidebar.tabs.ChatLog;

  if (!ChatLog?.CHAT_COMMANDS) {
    console.error(
      `${MODULE_ID} | ChatLog.CHAT_COMMANDS is unavailable.`
    );

    return;
  }

  for (const command of COMMANDS) {
    ChatLog.CHAT_COMMANDS[command] = {
      rgx: new RegExp(
        `^\\/${command}(?:\\s*)$`,
        "i"
      ),

      fn: () => {
        openTracker();
        return false;
      }
    };
  }

  console.log(
    `${MODULE_ID} | Registered /played and /playtime.`
  );
}

/* ==========================================================================
   CONNECTION TRACKING
   ========================================================================== */

Hooks.on(
  "userConnected",
  async (user, connected) => {
    if (!isPrimaryGM()) {
      return;
    }

    const playtimes = getPlaytimes();
    const entry = getEntry(
      playtimes,
      user.id
    );

    if (connected) {
      if (!entry.startTime) {
        entry.startTime = Date.now();

        await savePlaytimes(
          playtimes
        );
      }

      return;
    }

    if (entry.startTime) {
      const now = Date.now();

      entry.total += Math.max(
        0,
        now - entry.startTime
      );

      entry.startTime = null;

      await savePlaytimes(
        playtimes
      );
    }
  }
);

/* ==========================================================================
   INITIALIZE ACTIVE USERS
   ========================================================================== */

async function initializeActiveUsers() {
  if (!isPrimaryGM()) {
    return;
  }

  const playtimes = getPlaytimes();
  const now = Date.now();

  let changed = false;

  for (const user of game.users.contents) {
    const entry = getEntry(
      playtimes,
      user.id
    );

    if (
      user.active &&
      !entry.startTime
    ) {
      entry.startTime = now;
      changed = true;
    }

    if (
      !user.active &&
      entry.startTime
    ) {
      entry.total += Math.max(
        0,
        now - entry.startTime
      );

      entry.startTime = null;
      changed = true;
    }
  }

  if (changed) {
    await savePlaytimes(
      playtimes
    );
  }
}

/* ==========================================================================
   CHECKPOINT
   ========================================================================== */

async function checkpointActiveUsers() {
  if (!isPrimaryGM()) {
    return;
  }

  const playtimes = getPlaytimes();
  const now = Date.now();

  let changed = false;

  for (const user of game.users.contents) {
    const entry =
      playtimes[user.id];

    if (
      !user.active ||
      !entry?.startTime
    ) {
      continue;
    }

    const elapsed = Math.max(
      0,
      now - entry.startTime
    );

    if (elapsed <= 0) {
      continue;
    }

    entry.total += elapsed;
    entry.startTime = now;

    changed = true;
  }

  if (changed) {
    await savePlaytimes(
      playtimes
    );
  }
}

/* ==========================================================================
   RESET
   ========================================================================== */

async function resetPlaytimes() {
  if (!game.user.isGM) {
    ui.notifications.warn(
      localize(
        "PLAYTIME-TRACKER.resetGMOnly",
        "Only a GM can reset playtime."
      )
    );

    return false;
  }

  if (!isPrimaryGM()) {
    ui.notifications.warn(
      localize(
        "PLAYTIME-TRACKER.resetPrimaryGMOnly",
        "Only the active GM can reset playtime."
      )
    );

    return false;
  }

  const DialogV2 =
    foundry.applications.api.DialogV2;

  if (!DialogV2) {
    ui.notifications.error(
      localize(
        "PLAYTIME-TRACKER.error.dialog",
        "Unable to open the Playtime Tracker."
      )
    );

    return false;
  }

  /*
   * Use literal button labels here.
   *
   * This prevents Foundry from displaying:
   * PLAYTIME-TRACKER.confirmReset
   * PLAYTIME-TRACKER.cancel
   *
   * if the language file has not been loaded/reloaded yet.
   */
  const confirmed =
    await DialogV2.confirm({
      window: {
        title: localize(
          "PLAYTIME-TRACKER.resetTitle",
          "Reset Playtime"
        ),

        icon:
          "fa-solid fa-rotate-left"
      },

      content: `
        <div class="playtime-reset-confirmation">

          <div class="
            playtime-reset-confirmation__icon
          ">
            <i class="
              fa-solid
              fa-triangle-exclamation
            "></i>
          </div>

          <h3>
            ${escapeHTML(
              localize(
                "PLAYTIME-TRACKER.resetQuestion",
                "Reset all recorded playtime?"
              )
            )}
          </h3>

          <p>
            ${escapeHTML(
              localize(
                "PLAYTIME-TRACKER.resetWarning",
                "This will permanently reset every user's accumulated playtime to zero. Players currently online will begin counting again from the moment of the reset."
              )
            )}
          </p>

        </div>
      `,

      /*
       * Explicit English labels.
       * These are intentionally NOT localized.
       */
      yes: {
        action: "yes",
        label: "Confirm Reset",
        icon: "fa-solid fa-rotate-left",
        type: "button"
      },

      no: {
        action: "no",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        default: true,
        type: "button"
      }
    });

  if (confirmed !== true) {
    return false;
  }

  /*
   * Create completely fresh playtime data.
   */
  const now = Date.now();
  const playtimes = {};

  for (const user of game.users.contents) {
    playtimes[user.id] = {
      total: 0,

      /*
       * Online users immediately begin a
       * brand-new session.
       */
      startTime:
        user.active
          ? now
          : null
    };
  }

  const saved =
    await savePlaytimes(
      playtimes
    );

  if (!saved) {
    return false;
  }

  ui.notifications.info(
    localize(
      "PLAYTIME-TRACKER.resetComplete",
      "All playtime has been reset."
    )
  );

  /*
   * Update the tracker immediately.
   */
  if (
    trackerDialog &&
    trackerDialog.rendered
  ) {
    await refreshTracker();
  }

  return true;
}

/* ==========================================================================
   OPEN TRACKER
   ========================================================================== */

async function openTracker() {
  if (
    trackerDialog &&
    trackerDialog.rendered
  ) {
    trackerDialog.bringToFront();

    await refreshTracker();

    return;
  }

  const DialogV2 =
    foundry.applications.api.DialogV2;

  if (!DialogV2) {
    ui.notifications.error(
      localize(
        "PLAYTIME-TRACKER.error.dialog",
        "Unable to open the Playtime Tracker."
      )
    );

    return;
  }

  const buttons = [];

  /*
   * RESET
   */
  if (isPrimaryGM()) {
    buttons.push({
      action: "reset",

      label: "Reset",

      icon:
        "fa-solid fa-rotate-left",

      callback: async () => {
        await resetPlaytimes();
      }
    });
  }

  /*
   * REFRESH
   */
  buttons.push({
    action: "refresh",

    label: "Refresh",

    icon:
      "fa-solid fa-arrows-rotate",

    callback: async () => {
      await refreshTracker();
    }
  });

  /*
   * CLOSE
   */
  buttons.push({
    action: "close",

    label: "Close",

    icon:
      "fa-solid fa-xmark"
  });

  trackerDialog =
    new DialogV2({
      window: {
        title: localize(
          "PLAYTIME-TRACKER.title",
          "Chronicle of Time"
        ),

        icon:
          "fa-solid fa-hourglass-half"
      },

      classes: [
        "playtime-tracker-window"
      ],

      position: {
        width: 590
      },

      content:
        buildTrackerContent(),

      buttons,

      form: {
        closeOnSubmit: true
      }
    });

  await trackerDialog.render({
    force: true
  });
}

/* ==========================================================================
   TRACKER CONTENT
   ========================================================================== */

function buildTrackerContent() {
  const playtimes = getPlaytimes();
  const now = Date.now();

  const users =
    game.users.contents
      .map(user => {
        const entry =
          playtimes[user.id] ??
          createEntry();

        return {
          user,

          milliseconds:
            getCurrentPlaytime(
              user,
              entry,
              now
            )
        };
      })
      .sort(
        (a, b) =>
          b.milliseconds -
          a.milliseconds
      );

  const totalTime =
    users.reduce(
      (sum, entry) =>
        sum + entry.milliseconds,
      0
    );

  const activeUsers =
    users.filter(
      entry =>
        entry.user.active
    ).length;

  const longestSession =
    users[0];

  const rows =
    users
      .map(
        ({ user, milliseconds }, index) =>
          buildUserRow(
            user,
            milliseconds,
            index
          )
      )
      .join("");

  return `
    <section class="playtime-tracker">

      <header class="
        playtime-tracker__hero
      ">

        <div class="
          playtime-tracker__hero-orbit
          orbit-one
        "></div>

        <div class="
          playtime-tracker__hero-orbit
          orbit-two
        "></div>

        <div class="
          playtime-tracker__hero-symbol
        ">
          <i class="
            fa-solid
            fa-hourglass-half
          "></i>
        </div>

        <div class="
          playtime-tracker__hero-text
        ">

          <span class="
            playtime-tracker__eyebrow
          ">
            ${escapeHTML(
              localize(
                "PLAYTIME-TRACKER.eyebrow",
                "Campaign Chronicle"
              )
            )}
          </span>

          <h2>
            ${escapeHTML(
              localize(
                "PLAYTIME-TRACKER.title",
                "Chronicle of Time"
              )
            )}
          </h2>

          <p>
            ${escapeHTML(
              localize(
                "PLAYTIME-TRACKER.subtitle",
                "A record of time spent within this world."
              )
            )}
          </p>

        </div>

      </header>

      <div class="
        playtime-tracker__stats
      ">

        <div class="playtime-stat">

          <div class="
            playtime-stat__icon
          ">
            <i class="
              fa-solid
              fa-users
            "></i>
          </div>

          <div>

            <span class="
              playtime-stat__label
            ">
              ${escapeHTML(
                localize(
                  "PLAYTIME-TRACKER.players",
                  "Players"
                )
              )}
            </span>

            <strong>
              ${users.length}
            </strong>

          </div>

        </div>

        <div class="playtime-stat">

          <div class="
            playtime-stat__icon
            online
          ">
            <i class="
              fa-solid
              fa-signal
            "></i>
          </div>

          <div>

            <span class="
              playtime-stat__label
            ">
              ${escapeHTML(
                localize(
                  "PLAYTIME-TRACKER.active",
                  "Active Now"
                )
              )}
            </span>

            <strong>
              ${activeUsers}
            </strong>

          </div>

        </div>

        <div class="playtime-stat">

          <div class="
            playtime-stat__icon
          ">
            <i class="
              fa-solid
              fa-clock
            "></i>
          </div>

          <div>

            <span class="
              playtime-stat__label
            ">
              ${escapeHTML(
                localize(
                  "PLAYTIME-TRACKER.total",
                  "Total Time"
                )
              )}
            </span>

            <strong>
              ${formatCompactDuration(
                totalTime
              )}
            </strong>

          </div>

        </div>

      </div>

      ${
        longestSession
          ? `
            <div class="
              playtime-tracker__leader
            ">

              <div class="
                playtime-tracker__leader-mark
              ">
                <i class="
                  fa-solid
                  fa-crown
                "></i>
              </div>

              <div class="
                playtime-tracker__leader-avatar
              ">
                <img
                  src="${escapeHTML(
                    longestSession.user.avatar ||
                    "icons/svg/mystery-man.svg"
                  )}"
                  alt=""
                >
              </div>

              <div class="
                playtime-tracker__leader-info
              ">

                <span>
                  ${escapeHTML(
                    localize(
                      "PLAYTIME-TRACKER.currentLeader",
                      "Current Leader"
                    )
                  )}
                </span>

                <strong>
                  ${escapeHTML(
                    longestSession.user.name
                  )}
                </strong>

              </div>

              <div class="
                playtime-tracker__leader-time
              ">
                ${formatDuration(
                  longestSession.milliseconds
                )}
              </div>

            </div>
          `
          : ""
      }

      <div class="
        playtime-tracker__list-header
      ">

        <span>
          ${escapeHTML(
            localize(
              "PLAYTIME-TRACKER.leaderboard",
              "Time Rankings"
            )
          )}
        </span>

        <span>
          ${escapeHTML(
            localize(
              "PLAYTIME-TRACKER.time",
              "Time"
            )
          )}
        </span>

      </div>

      <div class="
        playtime-tracker__players
      ">

        ${
          rows ||
          `
            <div class="
              playtime-tracker__empty
            ">
              ${escapeHTML(
                localize(
                  "PLAYTIME-TRACKER.empty",
                  "No users found."
                )
              )}
            </div>
          `
        }

      </div>

    </section>
  `;
}

/* ==========================================================================
   PLAYER ROW
   ========================================================================== */

function buildUserRow(
  user,
  milliseconds,
  index
) {
  const avatar =
    escapeHTML(
      user.avatar ||
      "icons/svg/mystery-man.svg"
    );

  const name =
    escapeHTML(
      user.name
    );

  const medalClass =
    index === 0
      ? "gold"
      : index === 1
        ? "silver"
        : index === 2
          ? "bronze"
          : "";

  const rank =
    index < 3
      ? `
        <span class="
          playtime-rank__medal
          ${medalClass}
        ">
          ${index + 1}
        </span>
      `
      : `
        <span class="
          playtime-rank__number
        ">
          ${index + 1}
        </span>
      `;

  const gmBadge =
    user.isGM
      ? `
        <span class="
          playtime-player__gm
        ">
          <i class="
            fa-solid
            fa-shield-halved
          "></i>
          GM
        </span>
      `
      : "";

  const status =
    user.active
      ? "is-online"
      : "is-offline";

  const statusLabel =
    user.active
      ? localize(
          "PLAYTIME-TRACKER.online",
          "Online"
        )
      : localize(
          "PLAYTIME-TRACKER.offline",
          "Offline"
        );

  return `
    <div class="
      playtime-player
      ${index < 3 ? "is-top" : ""}
      ${user.isGM ? "is-gm" : ""}
    ">

      <div class="
        playtime-player__rank
      ">
        ${rank}
      </div>

      <div class="
        playtime-player__avatar
      ">

        <img
          src="${avatar}"
          alt="${name}"
        />

        <span
          class="
            playtime-player__status
            ${status}
          "
          title="${escapeHTML(
            statusLabel
          )}"
        ></span>

      </div>

      <div class="
        playtime-player__identity
      ">

        <div class="
          playtime-player__name
        ">
          ${name}
        </div>

        <div class="
          playtime-player__badges
        ">

          ${gmBadge}

          <span class="
            playtime-player__online-label
            ${status}
          ">
            ${escapeHTML(
              statusLabel
            )}
          </span>

        </div>

      </div>

      <div class="
        playtime-player__time
      ">
        ${formatDuration(
          milliseconds
        )}
      </div>

    </div>
  `;
}

/* ==========================================================================
   REFRESH
   ========================================================================== */

async function refreshTracker() {
  if (
    !trackerDialog ||
    !trackerDialog.rendered
  ) {
    return;
  }

  const content =
    trackerDialog.element?.querySelector(
      ".window-content"
    );

  if (!content) {
    await trackerDialog.render({
      force: true
    });

    return;
  }

  content.innerHTML =
    buildTrackerContent();
}

/* ==========================================================================
   FORMATTING
   ========================================================================== */

function formatDuration(
  milliseconds
) {
  let totalMinutes =
    Math.floor(
      Math.max(
        0,
        milliseconds
      ) / 60000
    );

  const days =
    Math.floor(
      totalMinutes / 1440
    );

  totalMinutes %= 1440;

  const hours =
    Math.floor(
      totalMinutes / 60
    );

  const minutes =
    totalMinutes % 60;

  const parts = [];

  if (days > 0) {
    parts.push(
      `${days}d`
    );
  }

  if (
    hours > 0 ||
    days > 0
  ) {
    parts.push(
      `${hours}h`
    );
  }

  parts.push(
    `${minutes}m`
  );

  return parts.join(" ");
}

function formatCompactDuration(
  milliseconds
) {
  const totalHours =
    Math.floor(
      Math.max(
        0,
        milliseconds
      ) / 3600000
    );

  if (totalHours < 1000) {
    return `${totalHours}h`;
  }

  return `${
    Math.floor(
      totalHours / 100
    ) / 10
  }k h`;
}

/* ==========================================================================
   HTML ESCAPING
   ========================================================================== */

function escapeHTML(value) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

/* ==========================================================================
   SHUTDOWN
   ========================================================================== */

Hooks.once(
  "shutdown",
  () => {
    if (updateTimer) {
      window.clearInterval(
        updateTimer
      );

      updateTimer = null;
    }
  }
);
