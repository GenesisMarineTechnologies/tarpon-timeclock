/**
 * Tarpon Boatworks Time Clock — app.js  v3
 * =========================================
 * Paste your Apps Script Web App URL into APPS_SCRIPT_URL below.
 */

/* ── CONFIG ──────────────────────────────────────────────── */
const APPS_SCRIPT_URL = https://script.google.com/macros/s/AKfycbzebvDV7owDASWSXwo_GN6WkACaCnSg_UPaltDumR78KXfTUtX0MRQvvnsmz3WgAbxYMQ/exec; // ← paste here
const TIMEZONE        = "America/New_York";
const REFRESH_MS      = 30000; // auto-refresh every 30s

/* ── STATE ───────────────────────────────────────────────── */
let employees        = [];
let selectedEmployee = null;   // { employeeId, displayName, role }
let pendingAction    = null;   // { action: string, snap: employee snapshot }
let refreshTimer     = null;
let requestInFlight  = false;
let config           = { shiftStartTime: "07:00", shiftEndTime: "16:30", companyName: "Tarpon Boatworks" };

/* ── DOM ─────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

// Header
const liveTimeEl      = $("live-time");
const liveDateEl      = $("live-date");
const companyNameEl   = $("company-name");
const shiftDisplayEl  = $("shift-display");
const shiftStartLbl   = $("shift-start-label");
const shiftEndLbl     = $("shift-end-label");
const logoImg         = $("logo-img");
const offlineBanner   = $("offline-banner");
const refreshLabel    = $("refresh-label");

// Clock panel
const empSearch       = $("emp-search");
const empListEl       = $("emp-list");
const empSelectorWrap = $("emp-selector-wrap");
const selectedDisplay = $("selected-display");
const selectedNameEl  = $("selected-name");
const selectedAvatar  = $("selected-avatar");
const clearBtn        = $("clear-btn");
const btnIn           = $("btn-in");
const btnOut          = $("btn-out");
const statusMsg       = $("status-msg");

// Confirm modal
const confirmOverlay      = $("confirm-overlay");
const confirmActionLabel  = $("confirm-action-label");
const confirmNameEl       = $("confirm-name");
const confirmYesBtn       = $("confirm-yes");
const confirmNoBtn        = $("confirm-no");

// Today
const todayTbody        = $("today-tbody");
const todayDateLabel    = $("today-date-label");
const leadersRow        = $("leaders-row");

// Manual entry
const manualOverlay     = $("manual-overlay");
const manualEmpSelect   = $("manual-emp");
const manualDateInput   = $("manual-date");
const manualInInput     = $("manual-in");
const manualOutInput    = $("manual-out");
const manualResultEl    = $("manual-result");
const btnManualSave     = $("btn-manual-save");
const btnManualCancel   = $("btn-manual-cancel");
const manualClose       = $("manual-close");

/* ── CLOCK ───────────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  liveTimeEl.textContent = now.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: TIMEZONE
  });
  liveDateEl.textContent = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: TIMEZONE
  });
}
setInterval(updateClock, 1000);
updateClock();

/* ── UTILITIES ───────────────────────────────────────────── */
function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function fmtHHMM(shiftTime) {
  // Convert "07:00" → "7:00 AM"
  const [h, m] = shiftTime.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
}

function initials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
}

function getStatusCode(lateMin) {
  if (lateMin === null || lateMin === undefined) return "none";
  if (lateMin <= 0) return "green";
  if (lateMin === 1) return "yellow";
  if (lateMin <= 4) return "orange";
  return "red";
}

function deltaLabel(late, early) {
  if (late === null || late === undefined) return "—";
  if (late > 0)  return `+${late}m`;
  if (early > 0) return `-${early}m`;
  return "0";
}

function pillHTML(statusCode, lateMin, earlyMin, statusText) {
  if (!statusCode || statusCode === "none") {
    return `<span class="pill pill-none"><span class="pill-dot dot-none"></span>Not In</span>`;
  }
  const labels = { green:"On Time", yellow:"1 min", orange:`+${lateMin}m late`, red:`+${lateMin}m late` };
  const label  = statusText || labels[statusCode] || statusCode;
  // Derive code from statusText if needed
  const code = statusCode.toLowerCase();
  return `<span class="pill pill-${code}"><span class="pill-dot dot-${code}"></span>${label}</span>`;
}

/* ── API ─────────────────────────────────────────────────── */
async function apiGet(route, params = {}) {
  const qs = new URLSearchParams({ route, ...params }).toString();
  const r  = await fetch(`${APPS_SCRIPT_URL}?${qs}`, { method: "GET" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function apiPost(route, body = {}) {
  const r = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, ...body })
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function setOffline(offline) {
  offlineBanner.classList.toggle("hidden", !offline);
}

/* ── CONFIG LOAD ─────────────────────────────────────────── */
async function loadConfig() {
  try {
    const data = await apiGet("config");
    if (data.ok) {
      config = { ...config, ...data };
      // Apply to UI
      if (data.companyName) companyNameEl.textContent = data.companyName;
      if (data.logoUrl) { logoImg.src = data.logoUrl; logoImg.style.display = ""; }
      const startFmt = fmtHHMM(data.shiftStartTime || "07:00");
      const endFmt   = fmtHHMM(data.shiftEndTime   || "16:30");
      shiftDisplayEl.textContent = `${startFmt} – ${endFmt}`;
      shiftStartLbl.textContent  = startFmt;
      shiftEndLbl.textContent    = endFmt;
    }
  } catch (_) {}
}

/* ── EMPLOYEES ───────────────────────────────────────────── */
async function loadEmployees() {
  try {
    const data = await apiGet("employees");
    if (data.ok) {
      employees = (data.employees || []);
      renderDropdown(employees);
      populateManualEmpSelect(employees);
      setOffline(false);
    }
  } catch (_) { setOffline(true); }
}

function renderDropdown(list) {
  if (!list.length) {
    empListEl.innerHTML = `<li style="pointer-events:none;color:var(--text-3);padding:16px;font-style:italic">No employees found</li>`;
    return;
  }
  empListEl.innerHTML = list.map(e => `
    <li data-id="${e.employeeId}" data-name="${e.displayName}" data-role="${e.role||""}">
      <div class="emp-avatar-sm">${initials(e.displayName)}</div>
      ${e.displayName}
      ${e.role ? `<span class="emp-role">${e.role}</span>` : ""}
    </li>`
  ).join("");

  empListEl.querySelectorAll("li[data-id]").forEach(li =>
    li.addEventListener("click", () =>
      selectEmployee(li.dataset.id, li.dataset.name, li.dataset.role)
    )
  );
}

function populateManualEmpSelect(list) {
  manualEmpSelect.innerHTML = `<option value="">— Select Employee —</option>` +
    list.map(e => `<option value="${e.employeeId}">${e.displayName}</option>`).join("");
}

empSearch.addEventListener("focus", () => {
  renderDropdown(employees);
  empListEl.classList.add("open");
});
empSearch.addEventListener("input", () => {
  const q = empSearch.value.toLowerCase().trim();
  const filtered = q ? employees.filter(e => e.displayName.toLowerCase().includes(q)) : employees;
  renderDropdown(filtered);
  empListEl.classList.add("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest("#emp-selector-wrap")) empListEl.classList.remove("open");
});

function selectEmployee(id, name, role) {
  // Snapshot into state
  selectedEmployee = { employeeId: id, displayName: name, role: role || "" };
  empSearch.value  = "";
  empListEl.classList.remove("open");
  selectedNameEl.textContent    = name;
  selectedAvatar.textContent    = initials(name);
  selectedDisplay.classList.remove("hidden");
  btnIn.disabled  = false;
  btnOut.disabled = false;
  clearStatus();
}

clearBtn.addEventListener("click", clearSelection);
function clearSelection() {
  selectedEmployee = null;
  selectedDisplay.classList.add("hidden");
  btnIn.disabled  = true;
  btnOut.disabled = true;
  empSearch.value = "";
  clearStatus();
}

/* ── CONFIRM MODAL ───────────────────────────────────────── */
btnIn.addEventListener("click",  () => openConfirm("clock-in"));
btnOut.addEventListener("click", () => openConfirm("clock-out"));

function openConfirm(action) {
  if (!selectedEmployee || requestInFlight) return;
  // Snapshot employee at the moment the button is pressed
  const snap = { ...selectedEmployee };
  pendingAction = { action, snap };
  confirmActionLabel.textContent = action === "clock-in" ? "CLOCK IN" : "CLOCK OUT";
  confirmNameEl.textContent      = snap.displayName; // always from snapshot
  confirmOverlay.classList.remove("hidden");
}

confirmYesBtn.addEventListener("click", async () => {
  confirmOverlay.classList.add("hidden");
  if (!pendingAction) return;
  const { action, snap } = pendingAction;
  pendingAction = null;
  // Safety check: selected employee must still match
  if (!selectedEmployee || selectedEmployee.employeeId !== snap.employeeId) {
    showStatus("✗ Selection changed — please try again.", "error");
    return;
  }
  await doClockAction(action, snap);
});

confirmNoBtn.addEventListener("click", () => {
  confirmOverlay.classList.add("hidden");
  pendingAction = null;
  clearSelection();
});

confirmOverlay.addEventListener("click", e => {
  if (e.target === confirmOverlay) {
    confirmOverlay.classList.add("hidden");
    pendingAction = null;
  }
});

/* ── CLOCK ACTION ────────────────────────────────────────── */
async function doClockAction(action, emp) {
  requestInFlight = true;
  setButtonsLoading(true);
  clearStatus();

  try {
    const res = await apiPost(action, { employeeId: emp.employeeId });

    if (res.ok) {
      const verb = action === "clock-in" ? "clocked in" : "clocked out";
      const d    = res.data || {};
      const time = d.displayTime || "";
      const late = d.lateMinutes;
      let extra  = "";
      if (action === "clock-in") {
        if (late === 0)  extra = " — On Time";
        else if (late > 0) extra = " — " + late + " min late";
        else if (d.earlyMinutes > 0) extra = " — " + d.earlyMinutes + " min early";
      }
      showStatus(`✓ ${emp.displayName} ${verb} at ${time}${extra}`, "success");
      await refreshDashboard();
      setTimeout(() => {
        if (statusMsg.classList.contains("success")) clearSelection();
      }, 5000);
    } else {
      showStatus(`✗ ${res.error || "Action failed. Please try again."}`, "error");
    }
    setOffline(false);
  } catch (_) {
    showStatus("✗ Cannot reach server. Check your connection.", "error");
    setOffline(true);
  }

  requestInFlight = false;
  setButtonsLoading(false);
  if (selectedEmployee) { btnIn.disabled = false; btnOut.disabled = false; }
}

function setButtonsLoading(on) {
  btnIn.disabled  = on;
  btnOut.disabled = on;
  if (on) {
    btnIn.querySelector(".btn-label").innerHTML  = `<span class="btn-spinner"></span>`;
    btnOut.querySelector(".btn-label").innerHTML = `<span class="btn-spinner"></span>`;
  } else {
    btnIn.querySelector(".btn-label").textContent  = "CLOCK IN";
    btnOut.querySelector(".btn-label").textContent = "CLOCK OUT";
  }
}

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className   = `status-msg ${type}`;
}
function clearStatus() {
  statusMsg.className   = "status-msg hidden";
  statusMsg.textContent = "";
}

/* ── TODAY ROSTER ────────────────────────────────────────── */
async function loadTodayRoster() {
  try {
    const data = await apiGet("dashboard", { date: todayStr() });
    if (data.ok) renderRoster(data.rows || []);
    setOffline(false);
  } catch (_) { setOffline(true); }
}

function renderRoster(rows) {
  todayDateLabel.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: TIMEZONE
  });

  if (!rows.length) {
    todayTbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No employees found</td></tr>`;
    return;
  }

  todayTbody.innerHTML = rows.map(r => {
    const hasIn  = !!r.clockInDisplay;
    const late   = r.lateMinutes;
    const early  = r.earlyMinutes;
    const code   = (r.statusCode ? r.statusCode.toLowerCase() : "") || "none";
    const delta  = hasIn ? deltaLabel(late, early) : "—";
    const dColor = code === "green" ? "var(--green)"
      : code === "yellow" ? "var(--yellow)"
      : code === "orange" ? "var(--orange)"
      : code === "red"    ? "var(--red)" : "var(--text-3)";

    // Parse status text from sheet (like "⚠ +3 MIN" or "✓ ON TIME")
    let pillCode = code;
    const pill   = pillHTML(pillCode, late, early, r.statusText);

    return `<tr>
      <td class="td-name">${r.displayName}</td>
      <td class="td-time">${r.clockInDisplay  || "—"}</td>
      <td class="td-time">${r.clockOutDisplay || "—"}</td>
      <td class="td-delta" style="color:${dColor}">${delta}</td>
      <td class="td-status">${pill}</td>
    </tr>`;
  }).join("");
}

/* ── LEADERS STRIP ───────────────────────────────────────── */
async function loadLeaders() {
  try {
    const data = await apiGet("stats");
    if (!data.ok) return;
    const list = data.weekLeaders || [];
    if (!list.length) {
      leadersRow.innerHTML = `<span class="leader-placeholder">No data yet this week</span>`;
      return;
    }
    const medals = ["🥇","🥈","🥉"];
    leadersRow.innerHTML = list.map((l,i) => `
      <div class="leader-chip">
        <span class="leader-medal">${medals[i]||""}</span>
        <span class="leader-name">${l.displayName}</span>
        <span class="leader-pct">${l.onTimePercent}%</span>
      </div>
    `).join("");
  } catch (_) {}
}

/* ── FULL REFRESH ────────────────────────────────────────── */
async function refreshDashboard() {
  await Promise.all([loadTodayRoster(), loadLeaders()]);
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE
  });
  refreshLabel.textContent = `Updated ${t} · refreshes every 30s`;
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshDashboard, REFRESH_MS);
}

/* ── MANUAL ENTRY ────────────────────────────────────────── */
$("btn-admin").addEventListener("click", openManual);

function openManual() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  manualDateInput.value = today;
  manualInInput.value   = "";
  manualOutInput.value  = "";
  manualEmpSelect.value = "";
  manualResultEl.className = "manual-result hidden";
  manualResultEl.textContent = "";
  manualOverlay.classList.remove("hidden");
}

function closeManual() { manualOverlay.classList.add("hidden"); }

manualClose.addEventListener("click", closeManual);
btnManualCancel.addEventListener("click", closeManual);
manualOverlay.addEventListener("click", e => {
  if (e.target === manualOverlay) closeManual();
});

btnManualSave.addEventListener("click", async () => {
  const empId   = manualEmpSelect.value;
  const date    = manualDateInput.value;
  const cinRaw  = manualInInput.value;
  const coutRaw = manualOutInput.value;

  // Convert HH:MM (time input format) to "H:MM AM/PM"
  function toAmPm(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
  }

  const cin  = toAmPm(cinRaw);
  const cout = toAmPm(coutRaw);

  manualResultEl.className = "manual-result hidden";

  if (!empId || !date) {
    showManualResult("Please select an employee and date.", "error"); return;
  }
  if (!cin && !cout) {
    showManualResult("Enter at least a clock-in time.", "error"); return;
  }
  if (cin && cout && coutRaw <= cinRaw) {
    showManualResult("Clock-out must be after clock-in.", "error"); return;
  }

  btnManualSave.textContent = "SAVING…";
  btnManualSave.disabled    = true;

  try {
    const res = await apiPost("manual-entry", {
      employeeId: empId, date, clockIn: cin, clockOut: cout
    });
    if (res.ok) {
      const selOpt = manualEmpSelect.selectedOptions[0];
      const name   = (selOpt ? selOpt.text : "") || empId;
      showManualResult(
        `✓ Saved: ${name} on ${date}\n` +
        `Clock In: ${cin || "—"}   Clock Out: ${cout || "—"}\n` +
        `Status recalculated automatically on the Google Sheet.`,
        "success"
      );
      await refreshDashboard();
    } else {
      showManualResult(`✗ ${res.error || "Save failed."}`, "error");
    }
  } catch (_) {
    showManualResult("✗ Cannot reach server.", "error");
  }

  btnManualSave.textContent = "SAVE ENTRY";
  btnManualSave.disabled    = false;
});

function showManualResult(msg, type) {
  manualResultEl.textContent = msg;
  manualResultEl.className   = `manual-result ${type}`;
}

/* ── INIT ────────────────────────────────────────────────── */
async function init() {
  await loadConfig();
  await loadEmployees();
  await refreshDashboard();
  startAutoRefresh();
}

init();
