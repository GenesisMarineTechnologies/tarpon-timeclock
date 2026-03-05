/*
 * Tarpon Boatworks Time Clock — app.js
 * =====================================
 * STEP 1: Replace the URL below with your Apps Script Web App URL
 * STEP 2: Upload this file to GitHub
 */

var APPS_SCRIPT_URL = https://script.google.com/macros/s/AKfycbzebvDV7owDASWSXwo_GN6WkACaCnSg_UPaltDumR78KXfTUtX0MRQvvnsmz3WgAbxYMQ/exec;
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
var employees = [];
var selectedEmployee = null;
var pendingAction = null;
var requestInFlight = false;

/* ── WAIT FOR DOM ───────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  if (APPS_SCRIPT_URL === https://script.google.com/macros/s/AKfycbzebvDV7owDASWSXwo_GN6WkACaCnSg_UPaltDumR78KXfTUtX0MRQvvnsmz3WgAbxYMQ/exec) {
    showStatus("Apps Script URL not set — open app.js on GitHub and paste your URL on line 8", "error");
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
  body.route = route;
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json(); })
    .then(function (d) { callback(null, d); })
    .catch(function (e) { callback(e, null); });
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
    if (data.logoUrl) {
      var img = document.getElementById("logo-img");
      img.src = data.logoUrl;
      img.style.display = "block";
      document.getElementById("logo-svg").style.display = "none";
    }
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

function renderEmployeeList(list) {
  var el = document.getElementById("emp-list");
  if (!list || !list.length) {
    el.innerHTML = "<li style='pointer-events:none;color:#4a7a95;padding:16px;font-style:italic'>No employees found</li>";
    return;
  }
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    html += "<li data-id='" + e.employeeId + "' data-name='" + e.displayName + "' data-role='" + (e.role || "") + "'>";
    html += "<div class='emp-avatar-sm'>" + initials(e.displayName) + "</div>";
    html += e.displayName;
    if (e.role) html += "<span class='emp-role'>" + e.role + "</span>";
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
    sel.innerHTML += "<option value='" + list[i].employeeId + "'>" + list[i].displayName + "</option>";
  }
}

/* Employee search */
document.getElementById("emp-search").addEventListener("focus", function () {
  renderEmployeeList(employees);
  document.getElementById("emp-list").classList.add("open");
});

document.getElementById("emp-search").addEventListener("input", function () {
  var q = this.value.toLowerCase();
  var filtered = [];
  for (var i = 0; i < employees.length; i++) {
    if (employees[i].displayName.toLowerCase().indexOf(q) >= 0) filtered.push(employees[i]);
  }
  renderEmployeeList(filtered);
  document.getElementById("emp-list").classList.add("open");
});

document.addEventListener("click", function (e) {
  if (!e.target.closest("#emp-selector-wrap")) {
    document.getElementById("emp-list").classList.remove("open");
  }
});

/* ── SELECT / CLEAR ─────────────────────────────────────── */
function selectEmployee(id, name, role) {
  selectedEmployee = { employeeId: id, displayName: name, role: role || "" };
  document.getElementById("emp-search").value = "";
  document.getElementById("emp-list").classList.remove("open");
  document.getElementById("selected-name").textContent = name;
  document.getElementById("selected-avatar").textContent = initials(name);
  document.getElementById("selected-display").classList.remove("hidden");
  document.getElementById("btn-in").disabled = false;
  document.getElementById("btn-out").disabled = false;
  clearStatus();
}

document.getElementById("clear-btn").addEventListener("click", function () {
  clearSelection();
});

function clearSelection() {
  selectedEmployee = null;
  document.getElementById("selected-display").classList.add("hidden");
  document.getElementById("btn-in").disabled = true;
  document.getElementById("btn-out").disabled = true;
  document.getElementById("emp-search").value = "";
  clearStatus();
}

/* ── CONFIRM MODAL ──────────────────────────────────────── */
document.getElementById("btn-in").addEventListener("click", function () {
  openConfirm("clock-in");
});
document.getElementById("btn-out").addEventListener("click", function () {
  openConfirm("clock-out");
});

function openConfirm(action) {
  if (!selectedEmployee || requestInFlight) return;
  var snap = { employeeId: selectedEmployee.employeeId, displayName: selectedEmployee.displayName };
  pendingAction = { action: action, snap: snap };
  document.getElementById("confirm-action-label").textContent = action === "clock-in" ? "CLOCK IN" : "CLOCK OUT";
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

/* ── CLOCK ACTION ───────────────────────────────────────── */
function doClockAction(action, emp) {
  requestInFlight = true;
  document.getElementById("btn-in").disabled  = true;
  document.getElementById("btn-out").disabled = true;
  document.getElementById("btn-in").querySelector(".btn-label").textContent  = "...";
  document.getElementById("btn-out").querySelector(".btn-label").textContent = "...";
  clearStatus();

  apiPost(action, { employeeId: emp.employeeId }, function (err, res) {
    requestInFlight = false;
    document.getElementById("btn-in").querySelector(".btn-label").textContent  = "CLOCK IN";
    document.getElementById("btn-out").querySelector(".btn-label").textContent = "CLOCK OUT";

    if (err || !res) {
      showStatus("Cannot reach server. Check Wi-Fi.", "error");
      if (selectedEmployee) {
        document.getElementById("btn-in").disabled  = false;
        document.getElementById("btn-out").disabled = false;
      }
      return;
    }

    if (res.ok) {
      var d     = res.data || {};
      var verb  = action === "clock-in" ? "clocked in" : "clocked out";
      var time  = d.displayTime || "";
      var extra = "";
      if (action === "clock-in") {
        var late  = parseInt(d.lateMinutes)  || 0;
        var early = parseInt(d.earlyMinutes) || 0;
        if (late > 0)       extra = " \u2014 " + late + " min late";
        else if (early > 0) extra = " \u2014 " + early + " min early";
        else                extra = " \u2014 On Time";
      }
      showStatus(emp.displayName + " " + verb + " at " + time + extra, "success");
      loadDashboard();
      loadLeaders();
      setTimeout(function () { clearSelection(); }, 4000);
    } else {
      showStatus(res.error || "Action failed. Please try again.", "error");
      if (selectedEmployee) {
        document.getElementById("btn-in").disabled  = false;
        document.getElementById("btn-out").disabled = false;
      }
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
    renderRoster(data.rows || []);
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
    var r     = rows[i];
    var hasIn = !!r.clockInDisplay;
    var late  = parseInt(r.lateMinutes)  || 0;
    var early = parseInt(r.earlyMinutes) || 0;
    var code  = hasIn ? getStatusCode(late) : "none";

    var delta = "\u2014";
    if (hasIn) {
      if (late > 0)       delta = "+" + late + "m";
      else if (early > 0) delta = "-" + early + "m";
      else                delta = "0";
    }

    var dColor = code === "green"  ? "var(--green)"
               : code === "yellow" ? "var(--yellow)"
               : code === "orange" ? "var(--orange)"
               : code === "red"    ? "var(--red)" : "var(--text-3)";

    var pillLabel = !hasIn ? "Not In"
      : code === "green"  ? "On Time"
      : code === "yellow" ? "1 min late"
      : late + "m late";

    html += "<tr>";
    html += "<td class='td-name'>" + r.displayName + "</td>";
    html += "<td class='td-time'>" + (r.clockInDisplay  || "\u2014") + "</td>";
    html += "<td class='td-time'>" + (r.clockOutDisplay || "\u2014") + "</td>";
    html += "<td class='td-delta' style='color:" + dColor + "'>" + delta + "</td>";
    html += "<td><span class='pill pill-" + code + "'><span class='pill-dot dot-" + code + "'></span>" + pillLabel + "</span></td>";
    html += "</tr>";
  }
  document.getElementById("today-tbody").innerHTML = html;
}

/* ── LEADERS ────────────────────────────────────────────── */
function loadLeaders() {
  apiGet("stats", {}, function (err, data) {
    if (err || !data || !data.ok) return;
    var list = data.weekLeaders || [];
    if (!list.length) {
      document.getElementById("leaders-row").innerHTML =
        "<span class='leader-placeholder'>No data yet this week</span>";
      return;
    }
    var medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
    var html = "";
    for (var i = 0; i < list.length; i++) {
      html += "<div class='leader-chip'>";
      html += "<span class='leader-medal'>" + (medals[i] || "") + "</span>";
      html += "<span class='leader-name'>" + list[i].displayName + "</span>";
      html += "<span class='leader-pct'>" + list[i].onTimePercent + "%</span>";
      html += "</div>";
    }
    document.getElementById("leaders-row").innerHTML = html;
  });
}

/* ── MANUAL ENTRY ───────────────────────────────────────── */
document.getElementById("btn-admin").addEventListener("click", function () {
  var pin = prompt("Enter admin PIN:");
  if (pin !== "1234") { alert("Incorrect PIN."); return; }
  openManual();
});

function openManual() {
  var today = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  document.getElementById("manual-date").value = today;
  document.getElementById("manual-in").value   = "";
  document.getElementById("manual-out").value  = "";
  document.getElementById("manual-emp").value  = "";
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
  var empId   = document.getElementById("manual-emp").value;
  var date    = document.getElementById("manual-date").value;
  var cinRaw  = document.getElementById("manual-in").value;
  var coutRaw = document.getElementById("manual-out").value;
  var resEl   = document.getElementById("manual-result");

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

  if (!empId || !date) {
    resEl.textContent = "Please select an employee and date.";
    resEl.className = "manual-result error"; return;
  }
  if (!cin && !cout) {
    resEl.textContent = "Enter at least a clock-in time.";
    resEl.className = "manual-result error"; return;
  }
  if (cin && cout && coutRaw <= cinRaw) {
    resEl.textContent = "Clock-out must be after clock-in.";
    resEl.className = "manual-result error"; return;
  }

  document.getElementById("btn-manual-save").textContent = "SAVING...";
  document.getElementById("btn-manual-save").disabled = true;

  apiPost("manual-entry", { employeeId: empId, date: date, clockIn: cin, clockOut: cout }, function (err, res) {
    document.getElementById("btn-manual-save").textContent = "SAVE ENTRY";
    document.getElementById("btn-manual-save").disabled = false;

    if (err || !res) {
      resEl.textContent = "Cannot reach server.";
      resEl.className = "manual-result error"; return;
    }
    if (res.ok) {
      var sel  = document.getElementById("manual-emp");
      var name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : empId;
      resEl.textContent = "Saved: " + name + " on " + date + "  In: " + (cin || "\u2014") + "  Out: " + (cout || "\u2014");
      resEl.className = "manual-result success";
      loadDashboard();
    } else {
      resEl.textContent = res.error || "Save failed.";
      resEl.className = "manual-result error";
    }
  });
});
