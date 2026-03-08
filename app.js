var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzW62kqp6ATWbFCyjOCCTw603TDBOPwuZfIIgdXXx9pebzoSF0Ap1Cd05Fz4ZZGR4yv/exec";
var TIMEZONE = "America/New_York";

/* ── CLOCK — runs immediately, no API needed ────────────── */
function updateClock() {
  try {
    var now = new Date();
    document.getElementById("live-time").textContent = now.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: TIMEZONE
    });
    document.getElementById("live-date").textContent = now.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: TIMEZONE
    });
    document.getElementById("today-date-label").textContent = now.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: TIMEZONE
    });
  } catch (e) {}
}
setInterval(updateClock, 1000);
updateClock();

/* ── STATE ──────────────────────────────────────────────── */
var employees        = [];
var selectedEmployee = null;
var pendingAction    = null;
var requestInFlight  = false;
var lunchStartTime   = "12:00";
var lunchEndTime     = "12:30";

/* ── WAIT FOR DOM ───────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("script.google.com/macros/s/") === -1) {
    showStatus("Apps Script URL not set — open app.js and paste your deployment URL on line 1", "error");
    document.getElementById("refresh-label").textContent = "Not connected — URL missing";
    return;
  }
  init();
});

/* ── HELPERS ────────────────────────────────────────────── */
function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function fmt12(t) {
  var parts = t.split(":");
  var h = parseInt(parts[0]);
  var m = parts[1];
  var ampm = h >= 12 ? "PM" : "AM";
  var h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return h12 + ":" + m + " " + ampm;
}

function initials(name) {
  if (!name) return "?";
  var words = name.split(" ");
  var out = "";
  for (var i = 0; i < words.length; i++) {
    if (words[i] && words[i][0]) out += words[i][0];
  }
  return out.slice(0, 2).toUpperCase();
}

function getStatusCode(lateMin) {
  lateMin = parseInt(lateMin);
  if (isNaN(lateMin) || lateMin <= 0) return "green";
  if (lateMin === 1) return "yellow";
  if (lateMin <= 4)  return "orange";
  return "red";
}

/* ── API ────────────────────────────────────────────────── */
function apiGet(route, params, callback) {
  var qs = "route=" + encodeURIComponent(route);
  if (params) {
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      qs += "&" + encodeURIComponent(keys[i]) + "=" + encodeURIComponent(params[keys[i]]);
    }
  }
  fetch(APPS_SCRIPT_URL + "?" + qs)
    .then(function (r) { return r.json(); })
    .then(function (d) { callback(null, d); })
    .catch(function (e) { callback(e, null); });
}

function apiPost(route, body, callback) {
  var params = { route: route };
  var keys = Object.keys(body);
  for (var i = 0; i < keys.length; i++) { params[keys[i]] = body[keys[i]]; }
  apiGet(route, params, callback);
}

/* ── INIT ───────────────────────────────────────────────── */
function init() {
  loadConfig();
  loadEmployees();
  loadDashboard();
  loadLeaders();
  setInterval(function () {
    loadDashboard();
    loadLeaders();
  }, 30000);
}

/* ── CONFIG ─────────────────────────────────────────────── */
function loadConfig() {
  apiGet("config", {}, function (err, data) {
    if (err || !data || !data.ok) return;
    if (data.companyName) {
      document.getElementById("company-name").textContent = data.companyName;
    }
    if (data.shiftStartTime && data.shiftEndTime) {
      var s = fmt12(data.shiftStartTime);
      var e = fmt12(data.shiftEndTime);
      document.getElementById("shift-display").textContent = s + " \u2013 " + e;
      document.getElementById("shift-start-label").textContent = s;
      document.getElementById("shift-end-label").textContent = e;
    }
    if (data.lunchStartTime) lunchStartTime = data.lunchStartTime;
    if (data.lunchEndTime)   lunchEndTime   = data.lunchEndTime;
  });
}

/* ── EMPLOYEES ──────────────────────────────────────────── */
function loadEmployees() {
  document.getElementById("refresh-label").textContent = "Loading employees...";
  apiGet("employees", {}, function (err, data) {
    if (err || !data || !data.ok) {
      document.getElementById("refresh-label").textContent = "Could not connect to Google Sheet";
      showStatus("Cannot reach server — check your Apps Script URL is correct and deployed", "error");
      return;
    }
    employees = data.employees || [];
    renderEmployeeList(employees);
    populateManualSelect(employees);
    var t = new Date().toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE
    });
    document.getElementById("refresh-label").textContent = "Connected \u00b7 Updated " + t;
  });
}

function escAttr(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/'/g,"&#39;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderEmployeeList(list) {
  var el = document.getElementById("emp-list");
  el.classList.add("open");
  if (!list || !list.length) {
    el.innerHTML = "<li style='pointer-events:none;color:#4a7a95;padding:16px;font-style:italic'>No employees found</li>";
    return;
  }
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    html += "<li data-id='" + escAttr(e.employeeId) + "' data-name='" + escAttr(e.displayName) + "' data-role='" + escAttr(e.role || "") + "'>";
    html += "<div class='emp-avatar-sm'>" + escHtml(initials(e.displayName)) + "</div>";
    html += escHtml(e.displayName);
    if (e.role) html += "<span class='emp-role'>" + escHtml(e.role) + "</span>";
    html += "</li>";
  }
  el.innerHTML = html;
  var items = el.querySelectorAll("li[data-id]");
  for (var j = 0; j < items.length; j++) {
    (function (li) {
      li.addEventListener("click", function () {
        selectEmployee(
          li.getAttribute("data-id"),
          li.getAttribute("data-name"),
          li.getAttribute("data-role")
        );
      });
    })(items[j]);
  }
}

function populateManualSelect(list) {
  var sel = document.getElementById("manual-emp");
  sel.innerHTML = "<option value=''>-- Select Employee --</option>";
  for (var i = 0; i < list.length; i++) {
    sel.innerHTML += "<option value='" + escAttr(list[i].employeeId) + "'>" + escHtml(list[i].displayName) + "</option>";
  }
}

/* Employee search */
document.getElementById("emp-search").addEventListener("input", function () {
  var q = this.value.toLowerCase();
  var filtered = [];
  for (var i = 0; i < employees.length; i++) {
    if (employees[i].displayName.toLowerCase().indexOf(q) >= 0) filtered.push(employees[i]);
  }
  renderEmployeeList(filtered);
});

document.getElementById("emp-search").addEventListener("focus", function () {
  renderEmployeeList(employees);
});

/* ── SELECT / CLEAR ─────────────────────────────────────── */
function selectEmployee(id, name, role) {
  selectedEmployee = { employeeId: id, displayName: name, role: role || "" };
  document.getElementById("emp-search").value = "";
  renderEmployeeList(employees);
  document.getElementById("selected-name").textContent = name;
  document.getElementById("selected-avatar").textContent = initials(name);
  document.getElementById("selected-display").classList.remove("hidden");
  // Buttons enabled; updateButtonState will refine once dashboard loads
  document.getElementById("btn-in").disabled = false;
  document.getElementById("btn-out").disabled = false;
  updateButtonStateForEmployee(id);
  clearStatus();
}

document.getElementById("clear-btn").addEventListener("click", function () {
  clearSelection();
});

function clearSelection() {
  selectedEmployee = null;
  document.getElementById("selected-display").classList.add("hidden");
  document.getElementById("btn-in").disabled  = true;
  document.getElementById("btn-out").disabled = true;
  setLunchButtons("hidden");
  document.getElementById("emp-search").value = "";
  renderEmployeeList(employees);
  clearStatus();
}

/* ── BUTTON STATE MACHINE ───────────────────────────────── */
// punchState: none | in | lunch_out | out
var lastDashboardRows = [];

function updateButtonStateForEmployee(empId) {
  var row = null;
  for (var i = 0; i < lastDashboardRows.length; i++) {
    if (lastDashboardRows[i].employeeId === empId) { row = lastDashboardRows[i]; break; }
  }
  var state = row ? row.punchState : "none";
  applyButtonState(state);
}

function applyButtonState(state) {
  var btnIn   = document.getElementById("btn-in");
  var btnOut  = document.getElementById("btn-out");
  var btnLOut = document.getElementById("btn-lunch-out");
  var btnLIn  = document.getElementById("btn-lunch-in");

  // Clock In and Clock Out always visible; reset disabled + hide lunch buttons
  btnIn.disabled  = true;  btnIn.classList.remove("hidden");
  btnOut.disabled = true;  btnOut.classList.remove("hidden");
  btnLOut.classList.add("hidden"); btnLOut.disabled = true;
  btnLIn.classList.add("hidden");  btnLIn.disabled  = true;

  if (state === "none") {
    // Not clocked in — Clock In active only
    btnIn.disabled = false;

  } else if (state === "in") {
    // Clocked in — Clock Out active + Lunch Out available
    btnOut.disabled = false;
    btnLOut.classList.remove("hidden"); btnLOut.disabled = false;

  } else if (state === "lunch_out") {
    // At lunch — Back From Lunch only; Clock Out grayed (must return first)
    btnLIn.classList.remove("hidden"); btnLIn.disabled = false;

  } else if (state === "out") {
    // Day complete — both grayed
  }
}

function setLunchButtons(display) {
  if (display === "hidden") {
    ["btn-lunch-out","btn-lunch-in"].forEach(function(id) {
      var b = document.getElementById(id);
      if (b) { b.classList.add("hidden"); b.disabled = true; }
    });
  }
}

/* ── CONFIRM MODAL ──────────────────────────────────────── */
document.getElementById("btn-in").addEventListener("click", function () {
  openConfirm("clock-in");
});
document.getElementById("btn-out").addEventListener("click", function () {
  openConfirm("clock-out");
});
document.getElementById("btn-lunch-out").addEventListener("click", function () {
  openConfirm("lunch-out");
});
document.getElementById("btn-lunch-in").addEventListener("click", function () {
  openConfirm("lunch-in");
});

var ACTION_LABELS = {
  "clock-in":   "CLOCK IN",
  "clock-out":  "CLOCK OUT",
  "lunch-out":  "LUNCH OUT",
  "lunch-in":   "BACK FROM LUNCH"
};

function openConfirm(action) {
  if (!selectedEmployee || requestInFlight) return;
  var snap = { employeeId: selectedEmployee.employeeId, displayName: selectedEmployee.displayName };
  pendingAction = { action: action, snap: snap };
  document.getElementById("confirm-action-label").textContent = ACTION_LABELS[action] || action.toUpperCase();
  document.getElementById("confirm-name").textContent = snap.displayName;
  document.getElementById("confirm-overlay").classList.remove("hidden");
}

document.getElementById("confirm-yes").addEventListener("click", function () {
  document.getElementById("confirm-overlay").classList.add("hidden");
  if (!pendingAction) return;
  var action = pendingAction.action;
  var snap   = pendingAction.snap;
  pendingAction = null;
  if (!selectedEmployee || selectedEmployee.employeeId !== snap.employeeId) {
    showStatus("Selection changed — please try again.", "error");
    return;
  }
  doClockAction(action, snap);
});

document.getElementById("confirm-no").addEventListener("click", function () {
  document.getElementById("confirm-overlay").classList.add("hidden");
  pendingAction = null;
  clearSelection();
});

/* ── CLOCK / LUNCH ACTION ───────────────────────────────── */
function doClockAction(action, emp) {
  requestInFlight = true;

  // Disable all action buttons during flight
  var allBtns = ["btn-in","btn-out","btn-lunch-out","btn-lunch-in"];
  allBtns.forEach(function(id) {
    var b = document.getElementById(id);
    if (b) { b.disabled = true; }
  });
  clearStatus();

  apiPost(action, { employeeId: emp.employeeId }, function (err, res) {
    requestInFlight = false;

    if (err || !res) {
      showStatus("Cannot reach server. Check Wi-Fi.", "error");
      updateButtonStateForEmployee(emp.employeeId);
      return;
    }

    if (res.ok) {
      var d    = res.data || {};
      var time = d.displayTime || "";
      var msg  = "";

      if (action === "clock-in") {
        var late  = parseInt(d.lateMinutes)  || 0;
        var early = parseInt(d.earlyMinutes) || 0;
        var tag   = late > 0 ? " \u2014 " + late + " min late"
                  : early > 0 ? " \u2014 " + early + " min early"
                  : " \u2014 On Time";
        msg = emp.displayName + " clocked in at " + time + tag;

      } else if (action === "clock-out") {
        var hrs = d.workedHours ? " \u2014 " + d.workedHours + " hrs worked" : "";
        msg = emp.displayName + " clocked out at " + time + hrs;

      } else if (action === "lunch-out") {
        msg = emp.displayName + " went to lunch at " + time;

      } else if (action === "lunch-in") {
        var ll = parseInt(d.lunchLateMinutes) || 0;
        var ltag = ll > 0 ? " \u2014 " + ll + " min late returning" : " \u2014 on time";
        msg = emp.displayName + " returned from lunch at " + time + ltag;

      }

      showStatus(msg, "success");
      loadDashboard();
      loadLeaders();
      setTimeout(function () { clearSelection(); }, 4000);
    } else {
      showStatus(res.error || "Action failed. Please try again.", "error");
      updateButtonStateForEmployee(emp.employeeId);
    }
  });
}

/* ── STATUS MESSAGE ─────────────────────────────────────── */
function showStatus(msg, type) {
  var el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = "status-msg " + type;
}
function clearStatus() {
  var el = document.getElementById("status-msg");
  el.textContent = "";
  el.className = "status-msg hidden";
}

/* ── TODAY'S ROSTER ─────────────────────────────────────── */
function loadDashboard() {
  apiGet("dashboard", { date: todayStr() }, function (err, data) {
    if (err || !data || !data.ok) {
      document.getElementById("today-tbody").innerHTML =
        "<tr><td colspan='5' class='loading-cell'>Could not load roster</td></tr>";
      return;
    }
    lastDashboardRows = data.rows || [];
    renderRoster(lastDashboardRows);
    // Refresh button state for currently selected employee
    if (selectedEmployee) {
      updateButtonStateForEmployee(selectedEmployee.employeeId);
    }
  });
}

function renderRoster(rows) {
  if (!rows || !rows.length) {
    document.getElementById("today-tbody").innerHTML =
      "<tr><td colspan='5' class='empty-cell'>No punches yet today</td></tr>";
    return;
  }
  var html = "";
  for (var i = 0; i < rows.length; i++) {
    var r      = rows[i];
    var hasIn  = !!r.clockInDisplay;
    var hasOut = !!r.clockOutDisplay;
    var late   = parseInt(r.lateMinutes)  || 0;
    var ll     = parseInt(r.lunchLateMinutes) || 0;
    var state  = r.punchState || (hasIn ? "in" : "none");
    var code   = hasIn ? getStatusCode(late) : "none";
    var hrs    = hasOut ? (parseFloat(r.workedHours) || 0) : null;

    // Clock-In column — show lunch status if on lunch
    var cinDisplay = r.clockInDisplay || "\u2014";
    if (state === "lunch_out") {
      cinDisplay = (r.clockInDisplay || "") + "<br><span style='color:var(--yellow);font-size:11px'>\uD83C\uDF74 at lunch</span>";
    }

    // Delta column — PRIMARY: hours worked today (if complete); otherwise punctuality
    var deltaParts = [];
    if (hasIn) {
      if (hasOut && hrs > 0) {
        deltaParts.push('<span style="color:var(--green);font-weight:bold">' + hrs.toFixed(1) + 'h</span>');
      }
      if (late > 0) deltaParts.push('<span style="color:var(--' + (late >= 5 ? "red" : late >= 2 ? "orange" : "yellow") + ')">+' + late + 'm late</span>');
      if (ll   > 0) deltaParts.push('<span style="color:var(--orange)">\uD83C\uDF74+' + ll + 'm lunch</span>');
      if (!hasOut && late <= 0) deltaParts.push('<span style="color:var(--green)">on time</span>');
    }
    var delta = hasIn ? deltaParts.join('<br>') : "\u2014";

    // Status pill — arrival punctuality
    var pillLabel = !hasIn ? "Not In"
      : code === "green"  ? "On Time"
      : code === "yellow" ? "1 min late"
      : late + "m late";
    var pillCode = !hasIn ? "none" : code;

    // Clock-out column
    var coutDisplay = r.clockOutDisplay || "\u2014";

    html += "<tr>";
    html += "<td class='td-name'>" + escHtml(r.displayName) + "</td>";
    html += "<td class='td-time'>" + cinDisplay + "</td>";
    html += "<td class='td-time'>" + coutDisplay + "</td>";
    html += "<td class='td-delta'>" + delta + "</td>";
    html += "<td><span class='pill pill-" + pillCode + "'><span class='pill-dot dot-" + pillCode + "'></span>" + pillLabel + "</span></td>";
    html += "</tr>";
  }
  document.getElementById("today-tbody").innerHTML = html;
}

/* ── STATS PANEL ────────────────────────────────────────── */
var currentStatsTab = "week";

document.querySelectorAll(".stats-tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".stats-tab").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".stats-content").forEach(function (c) { c.classList.add("hidden"); });
    btn.classList.add("active");
    currentStatsTab = btn.getAttribute("data-tab");
    document.getElementById("stats-" + currentStatsTab).classList.remove("hidden");
  });
});

function loadLeaders() {
  apiGet("stats", {}, function (err, data) {
    if (err || !data || !data.ok) return;
    renderStatsTable("week",  data.weekLeaders  || [], data.weekStats  || []);
    renderStatsTable("month", data.monthLeaders || [], data.monthStats || []);
    renderStatsTable("year",  data.yearLeaders  || [], data.yearStats  || []);
  });
}

function renderStatsTable(period, leaders, allStats) {
  var el = document.getElementById("stats-" + period);
  if (!el) return;

  if (!allStats || !allStats.length) {
    el.innerHTML = "<span class='leader-placeholder'>No data yet</span>";
    return;
  }

  var sorted = allStats.slice().sort(function (a, b) {
    // Rank by total hours worked — most hours first
    var ha = a.totalHours !== null ? a.totalHours : -1;
    var hb = b.totalHours !== null ? b.totalHours : -1;
    if (hb !== ha) return hb - ha;
    return (a.displayName || "").localeCompare(b.displayName || "");
  });

  var medals     = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
  var leaderNames = leaders.map(function (l) { return l.displayName; });

  var html = "<table class='stats-table'>";
  html += "<thead><tr>";
  html += "<th class='st-name'>Employee</th>";
  html += "<th class='st-num'>Days</th>";
  html += "<th class='st-num' style='font-size:13px;color:var(--teal)'>Total<br>Hours</th>";
  html += "<th class='st-num' style='color:var(--green)'>OT<br>Hours</th>";
  html += "<th class='st-num'>On-Time<br>%</th>";
  html += "<th class='st-num' style='color:var(--red)'>Late<br>Min</th>";
  html += "<th class='st-num' style='color:var(--orange)'>\uD83C\uDF74<br>Late</th>";
  html += "</tr></thead><tbody>";

  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var medal = "";
    var leaderIdx = leaderNames.indexOf(s.displayName);
    if (leaderIdx >= 0 && leaderIdx < 3) medal = medals[leaderIdx] + " ";

    var pctColor = s.onTimePercent === null ? "var(--text-3)"
      : s.onTimePercent >= 90 ? "var(--green)"
      : s.onTimePercent >= 70 ? "var(--yellow)"
      : s.onTimePercent >= 50 ? "var(--orange)"
      : "var(--red)";

    var hrsColor  = s.totalHours         ? "var(--teal)"   : "var(--text-3)";
    var otColor   = s.totalOvertimeHrs   ? "var(--green)"  : "var(--text-3)";
    var lateColor = (s.totalLateMin||0) > 0 ? "var(--red)"   : "var(--text-3)";
    var llColor   = (s.totalLunchLateMin||0) > 0 ? "var(--orange)" : "var(--text-3)";

    html += "<tr class='st-row'>";
    html += "<td class='st-name'>" + medal + escHtml(s.displayName) + "</td>";
    html += "<td class='st-num'>" + (s.shifts || "\u2014") + "</td>";
    html += "<td class='st-num' style='color:" + hrsColor  + ";font-weight:bold'>" + (s.totalHours !== null ? s.totalHours : "\u2014") + "</td>";
    html += "<td class='st-num' style='color:" + otColor   + "'>" + (s.totalOvertimeHrs || "\u2014") + "</td>";
    html += "<td class='st-num' style='color:" + pctColor  + "'>" + (s.onTimePercent !== null ? s.onTimePercent + "%" : "\u2014") + "</td>";
    html += "<td class='st-num' style='color:" + lateColor + "'>" + (s.totalLateMin      || "\u2014") + "</td>";
    html += "<td class='st-num' style='color:" + llColor   + "'>" + (s.totalLunchLateMin || "\u2014") + "</td>";
    html += "</tr>";
  }
  html += "</tbody></table>";
  el.innerHTML = html;
}

/* ── MANUAL ENTRY ───────────────────────────────────────── */
document.getElementById("btn-admin").addEventListener("click", function () {
  var pin = prompt("Enter admin PIN:");
  if (pin !== "TB2026") { alert("Incorrect PIN."); return; }
  openManual();
});

function openManual() {
  var today = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  document.getElementById("manual-date").value     = today;
  document.getElementById("manual-in").value       = "";
  document.getElementById("manual-out").value      = "";
  document.getElementById("manual-lunch-out").value = "";
  document.getElementById("manual-lunch-in").value  = "";
  document.getElementById("manual-emp").value      = "";
  var resEl = document.getElementById("manual-result");
  resEl.className = "manual-result hidden";
  resEl.textContent = "";
  document.getElementById("manual-overlay").classList.remove("hidden");
}

function closeManual() {
  document.getElementById("manual-overlay").classList.add("hidden");
}

document.getElementById("manual-close").addEventListener("click", closeManual);
document.getElementById("btn-manual-cancel").addEventListener("click", closeManual);
document.getElementById("manual-overlay").addEventListener("click", function (e) {
  if (e.target === document.getElementById("manual-overlay")) closeManual();
});

document.getElementById("btn-manual-save").addEventListener("click", function () {
  var empId    = document.getElementById("manual-emp").value;
  var date     = document.getElementById("manual-date").value;
  var cinRaw   = document.getElementById("manual-in").value;
  var coutRaw  = document.getElementById("manual-out").value;
  var loutRaw  = document.getElementById("manual-lunch-out").value;
  var linRaw   = document.getElementById("manual-lunch-in").value;
  var resEl    = document.getElementById("manual-result");

  function toAmPm(hhmm) {
    if (!hhmm) return "";
    var parts = hhmm.split(":");
    var h = parseInt(parts[0]);
    var m = parts[1];
    var ampm = h >= 12 ? "PM" : "AM";
    var h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return h12 + ":" + m + " " + ampm;
  }

  var cin  = toAmPm(cinRaw);
  var cout = toAmPm(coutRaw);
  var lout = toAmPm(loutRaw);
  var lin  = toAmPm(linRaw);

  if (!empId || !date) {
    resEl.textContent = "Please select an employee and date.";
    resEl.className = "manual-result error"; return;
  }
  if (!cin && !cout && !lout && !lin) {
    resEl.textContent = "Enter at least one time.";
    resEl.className = "manual-result error"; return;
  }
  if (cin && cout && coutRaw <= cinRaw) {
    resEl.textContent = "Clock-out must be after clock-in.";
    resEl.className = "manual-result error"; return;
  }
  if (lout && lin && linRaw <= loutRaw) {
    resEl.textContent = "Lunch-in must be after lunch-out.";
    resEl.className = "manual-result error"; return;
  }

  document.getElementById("btn-manual-save").textContent = "SAVING...";
  document.getElementById("btn-manual-save").disabled = true;

  apiPost("manual-entry", {
    employeeId: empId,
    date:       date,
    clockIn:    cin,
    clockOut:   cout,
    lunchOut:   lout,
    lunchIn:    lin
  }, function (err, res) {
    document.getElementById("btn-manual-save").textContent = "SAVE ENTRY";
    document.getElementById("btn-manual-save").disabled = false;

    if (err || !res) {
      resEl.textContent = "Cannot reach server.";
      resEl.className = "manual-result error"; return;
    }
    if (res.ok) {
      var sel  = document.getElementById("manual-emp");
      var name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : empId;
      var lunchNote = res.data && res.data.lunchAssumed
        ? "  🍽 Lunch 12:00–12:30 PM assumed" : "";
      resEl.textContent = "Saved: " + name + " on " + date +
        "  In: " + (cin  || "\u2014") + "  Out: " + (cout || "\u2014") +
        (lout ? "  Lunch Out: " + lout : "") +
        (lin  ? "  Lunch In: "  + lin  : "") +
        lunchNote;
      resEl.className = "manual-result success";
      loadDashboard();
    } else {
      resEl.textContent = res.error || "Save failed.";
      resEl.className = "manual-result error";
    }
  });
});
