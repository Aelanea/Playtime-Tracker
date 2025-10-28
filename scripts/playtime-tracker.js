const MODULE_ID = "playtime-tracker";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "playtimes", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
});

Hooks.once("ready", () => {
  if (game.user.isGM) {
    // Ensure start times for all currently active users
    updateStartTimes();
    // Periodic update to persist time every minute
    setInterval(updateActiveUsers, 60000);
  }

  // Chat command for /playtime
  Hooks.on("chatMessage", (log, msg) => {
    if (msg.trim() === "/playtime") {
      renderTracker();
      return false;
    }
  });
});

Hooks.on("userConnected", (user, connected) => {
  if (!game.user.isGM) return;
  const playtimes = foundry.utils.duplicate(game.settings.get(MODULE_ID, "playtimes"));

  if (connected) {
    if (!playtimes[user.id]) playtimes[user.id] = { total: 0, startTime: null };
    if (!playtimes[user.id].startTime) playtimes[user.id].startTime = Date.now();
  } else {
    if (playtimes[user.id]?.startTime) {
      const elapsed = Date.now() - playtimes[user.id].startTime;
      playtimes[user.id].total += elapsed;
      playtimes[user.id].startTime = null;
    }
  }

  game.settings.set(MODULE_ID, "playtimes", playtimes);
});

// Update start times for active users
function updateStartTimes() {
  const playtimes = foundry.utils.duplicate(game.settings.get(MODULE_ID, "playtimes"));
  let needsUpdate = false;
  for (const user of game.users) {
    if (user.active) {
      if (!playtimes[user.id]) playtimes[user.id] = { total: 0, startTime: null };
      if (!playtimes[user.id].startTime) {
        playtimes[user.id].startTime = Date.now();
        needsUpdate = true;
      }
    }
  }
  if (needsUpdate) game.settings.set(MODULE_ID, "playtimes", playtimes);
}

// Periodic update for all active users to minimize data loss on crash
function updateActiveUsers() {
  const playtimes = foundry.utils.duplicate(game.settings.get(MODULE_ID, "playtimes"));
  let needsUpdate = false;
  for (const user of game.users) {
    if (user.active && playtimes[user.id]?.startTime) {
      const elapsed = Date.now() - playtimes[user.id].startTime;
      playtimes[user.id].total += elapsed;
      playtimes[user.id].startTime = Date.now();
      needsUpdate = true;
    }
  }
  if (needsUpdate) game.settings.set(MODULE_ID, "playtimes", playtimes);
}

// Render /playtime dialog 
function renderTracker() {
  const playtimes = game.settings.get(MODULE_ID, "playtimes");
  const computed = Array.from(game.users).map(user => {
    const pt = playtimes[user.id] || { total: 0, startTime: null };
    const current = (user.active && pt.startTime) ? Date.now() - pt.startTime : 0;
    const totalMs = pt.total + current;
    return { id: user.id, ms: totalMs, user };
  }).sort((a, b) => b.ms - a.ms);

  const rows = computed.map(({ user, ms }) => {
    const name = user.name;
    const avatar = user.avatar || 'icons/svg/mystery-man.svg'; // Default avatar if none
    const isGM = user.isGM ? '<span class="gm-badge">GM</span>' : '';
    const isActive = user.active ? '<i class="fas fa-circle online-icon"></i>' : '<i class="fas fa-circle offline-icon"></i>';
    return `<tr class="${user.isGM ? 'gm-row' : ''}">
      <td class="user-cell">
        <img src="${avatar}" class="player-avatar" alt="${name}">
        <span class="user-name">${name} ${isGM}</span>
        ${isActive}
      </td>
      <td>${formatDuration(ms)}</td>
    </tr>`;
  }).join("");

  const html = `
    <style>
      /* Window styles */
      .playtime-dialog-window {
        background: transparent;
        border: none;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        border-radius: 16px;
        overflow: hidden;
      }
      .playtime-dialog-window .window-header {
        background: linear-gradient(to right, #4a0e4e, #7a1f7e); /* Soft purple-pink gradient */
        color: #ffd1dc; /* Soft pink text */
        border-bottom: none;
        padding: 12px 15px;
        font-size: 1.1em;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: 'Poppins', sans-serif;
      }
      .playtime-dialog-window .window-header .header-button.close {
        color: #ffd1dc;
        background: none;
        border: none;
        font-size: 1.3em;
        padding: 0 10px;
        transition: color 0.2s, transform 0.2s;
      }
      .playtime-dialog-window .window-header .header-button.close:hover {
        color: #ff85a2;
        transform: scale(1.1);
      }
      .playtime-dialog-window .window-content {
        background: linear-gradient(to bottom, #2c003e, #3e0d52); /* Dark purple background */
        padding: 0;
      }
      .playtime-dialog-window .dialog-buttons {
        background: #3e0d52;
        border-top: 1px solid rgba(255, 209, 220, 0.2);
        padding: 10px;
        text-align: center;
      }
      .playtime-dialog-window .dialog-buttons button {
        background: linear-gradient(to right, #ff69b4, #ba55d3); /* Hot pink to medium orchid */
        color: white;
        border: none;
        padding: 8px 20px;
        border-radius: 20px;
        font-weight: bold;
        font-family: 'Poppins', sans-serif;
        transition: background 0.2s, transform 0.2s;
        cursor: pointer;
      }
      .playtime-dialog-window .dialog-buttons button:hover {
        background: linear-gradient(to right, #ff1493, #9932cc);
        transform: translateY(-2px);
      }

      /* Content styles */
      .dialog-content {
        padding: 20px;
        font-family: 'Poppins', sans-serif;
        color: #ffd1dc;
      }
      .playtime-header {
        text-align: center;
        font-size: 1.3em;
        margin-bottom: 15px;
        color: #ff69b4; /* Hot pink */
        display: flex;
        align-items: center;
        justify-content: center;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      }
      .playtime-header i {
        margin-right: 10px;
        font-size: 1.2em;
        color: #ba55d3; /* Medium orchid */
      }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        background: #4a0e4e; /* Darker purple for table bg */
      }
      th, td {
        padding: 12px 15px;
        text-align: left;
        border-bottom: 1px solid rgba(255, 209, 220, 0.1);
      }
      th {
        background-color: #7a1f7e; /* Purple header */
        color: #ffd1dc;
        font-weight: bold;
      }
      tr:nth-child(even) {
        background-color: rgba(122, 31, 126, 0.2); /* Subtle purple tint */
      }
      tr:hover {
        background-color: rgba(186, 85, 211, 0.3); /* Soft orchid hover */
        transition: background-color 0.2s;
      }
      .gm-row {
        font-weight: bold;
        background-color: rgba(255, 105, 180, 0.2) !important; /* Soft pink for GM */
      }
      .gm-badge {
        background: #ff69b4; /* Hot pink */
        color: #2c003e;
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.85em;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }
      .player-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        margin-right: 12px;
        vertical-align: middle;
        border: 2px solid #ba55d3; /* Orchid border */
        box-shadow: 0 2px 6px rgba(186, 85, 211, 0.4);
      }
      .user-name {
        vertical-align: middle;
        font-size: 1em;
      }
      .online-icon {
        color: #98fb98; /* Pale green for online */
        margin-left: 12px;
        font-size: 0.9em;
        text-shadow: 0 0 4px rgba(152, 251, 152, 0.5);
      }
      .offline-icon {
        color: #ff85a2; /* Soft red-pink for offline */
        margin-left: 12px;
        font-size: 0.9em;
        text-shadow: 0 0 4px rgba(255, 133, 162, 0.5);
      }
      /* Google Fonts for soft feel */
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap');
      /* Font Awesome for icons */
      @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');
    </style>
    <div class="dialog-content">
      <div class="playtime-header"><i class="fas fa-clock"></i> Playtime Tracker</div>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Playtime</th>
          </tr>
        </thead>
        <tbody>
          ${rows || "<tr><td colspan='2' style='text-align:center; padding: 20px; color: #ff85a2;'>No data yet.</td></tr>"}
        </tbody>
      </table>
    </div>`;

  new Dialog({
    title: "Playtime Tracker",
    content: html,
    buttons: { close: { label: "Close" } },
    default: "close"
  }, {
    classes: ['dialog', 'playtime-dialog-window'],
    width: 450,
    height: 'auto'
  }).render(true);
}

// Format milliseconds
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}