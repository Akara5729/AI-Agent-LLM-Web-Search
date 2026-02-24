// ─── State ──────────────────────────────────────────
let isPaused = false;
let filterLevel = "ALL";
let counts = { total: 0, INFO: 0, WARN: 0, ERROR: 0 };

// ─── DOM ────────────────────────────────────────────
const logEntries = document.getElementById("log-entries");
const logContainer = document.getElementById("log-container");
const btnPause = document.getElementById("btn-pause");
const btnClear = document.getElementById("btn-clear");
const filterSelect = document.getElementById("filter-level");
const statusBadge = document.getElementById("status-badge");
const countTotal = document.getElementById("count-total");
const countInfo = document.getElementById("count-info");
const countWarn = document.getElementById("count-warn");
const countError = document.getElementById("count-error");

// ─── WebSocket Connection ───────────────────────────
let ws;
let reconnectTimer;

function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/ws/logs`);

    ws.onopen = () => {
        statusBadge.innerHTML = "● Connected";
        statusBadge.className =
            "text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-800";
        clearTimeout(reconnectTimer);
    };

    ws.onclose = () => {
        statusBadge.innerHTML = "● Disconnected";
        statusBadge.className =
            "text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-800";
        // Auto-reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
        ws.close();
    };

    ws.onmessage = (event) => {
        if (isPaused) return;

        try {
            const entry = JSON.parse(event.data);
            addLogEntry(entry);
        } catch { }
    };
}

// ─── Add Log Entry ──────────────────────────────────
function addLogEntry(entry) {
    // Update counts
    counts.total++;
    counts[entry.level] = (counts[entry.level] || 0) + 1;
    updateCounts();

    // Check filter
    const visible = filterLevel === "ALL" || entry.level === filterLevel;

    const div = document.createElement("div");
    div.className = `log-entry log-${entry.level} px-3 py-1.5 rounded ${visible ? "" : "hidden"}`;
    div.dataset.level = entry.level;

    const time = new Date(entry.timestamp).toLocaleTimeString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });

    div.innerHTML = `
    <span class="text-dark-500">${time}</span>
    <span class="log-level font-bold ml-2">[${entry.level}]</span>
    <span class="ml-2 text-dark-300">${escapeHtml(entry.message)}</span>
  `;

    logEntries.appendChild(div);

    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;

    // Limit to 500 entries
    while (logEntries.children.length > 500) {
        logEntries.removeChild(logEntries.firstChild);
    }
}

// ─── Update Counts ──────────────────────────────────
function updateCounts() {
    countTotal.textContent = counts.total;
    countInfo.textContent = counts.INFO || 0;
    countWarn.textContent = counts.WARN || 0;
    countError.textContent = counts.ERROR || 0;
}

// ─── Filter ─────────────────────────────────────────
filterSelect.addEventListener("change", (e) => {
    filterLevel = e.target.value;
    const entries = logEntries.querySelectorAll(".log-entry");
    entries.forEach((entry) => {
        if (filterLevel === "ALL" || entry.dataset.level === filterLevel) {
            entry.classList.remove("hidden");
        } else {
            entry.classList.add("hidden");
        }
    });
});

// ─── Pause/Resume ───────────────────────────────────
btnPause.addEventListener("click", () => {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? "▶ Resume" : "⏸ Pause";
    btnPause.classList.toggle("bg-yellow-900/30", isPaused);
    btnPause.classList.toggle("border-yellow-700", isPaused);
});

// ─── Clear ──────────────────────────────────────────
btnClear.addEventListener("click", () => {
    logEntries.innerHTML = "";
    counts = { total: 0, INFO: 0, WARN: 0, ERROR: 0 };
    updateCounts();
});

// ─── Utilities ──────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ─── Init ───────────────────────────────────────────
connect();
