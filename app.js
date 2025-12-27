const DB_NAME = "babylog_db";
const DB_VERSION = 1;
const STORE = "events";
const ACTIVE_FEED_KEY = "activeFeedId"; // stored in localStorage (simple)

const $ = (id) => document.getElementById(id);

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("by_startTs", "startTs");
      store.createIndex("by_type", "type");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addEvent(event) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(event);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function updateEvent(id, patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const obj = getReq.result;
      if (!obj) return reject(new Error("Event not found"));
      store.put({ ...obj, ...patch });
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteEvent(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function listEvents(limit = 200) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const index = store.index("by_startTs");
    const events = [];
    index.openCursor(null, "prev").onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || events.length >= limit) return resolve(events);
      events.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}


function fmtDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}

function durationMs(a, b) {
  const ms = Math.max(0, b - a);
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

function currentSide() {
  const el = document.querySelector('input[name="side"]:checked');
  return (el?.value ?? "") || null;
}

function setActiveFeed(id) {
  if (id == null) localStorage.removeItem(ACTIVE_FEED_KEY);
  else localStorage.setItem(ACTIVE_FEED_KEY, String(id));
  renderStatus();
}

function getActiveFeedId() {
  const v = localStorage.getItem(ACTIVE_FEED_KEY);
  return v ? Number(v) : null;
}

async function startFeed() {
  const startTs = Date.now();
  const side = currentSide();

  await addEvent({ type: "feed", startTs, endTs: null, side, notes: "" });
  const latest = (await listEvents(1))[0];
  setActiveFeed(latest?.id ?? null);
  await refresh();
}

async function stopFeed() {
  const id = getActiveFeedId();
  if (!id) return;
  await updateEvent(id, { endTs: Date.now() });
  setActiveFeed(null);
  await refresh();
}

async function logDiaper(type) {
  await addEvent({ type, startTs: Date.now(), endTs: null, side: null, notes: "" });
  await refresh();
}

async function undoLast() {
  const last = (await listEvents(1))[0];
  if (!last) return;

  if (last.type === "feed" && last.endTs == null && getActiveFeedId() === last.id) {
    setActiveFeed(null);
  }

  await deleteEvent(last.id);
  await refresh();
}

/* ------------------------------
   Manual Feed Modal (pickers)
-------------------------------- */

function isoDateLocal(d = new Date()) {
  // Local YYYY-MM-DD (not UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hhmm(d = new Date()) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function parseLocalDateTime(dateStr, timeStr) {
  // Builds a local Date from "YYYY-MM-DD" + "HH:MM"
  const [y, mo, da] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!y || !mo || !da || Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  return new Date(y, mo - 1, da, hh, mm, 0, 0).getTime();
}

function openManualModal() {
  // Defaults
  const now = new Date();
  const startDefault = new Date(now.getTime() - 20 * 60 * 1000); // 20 min ago

  $("mfDate").value = isoDateLocal(now);
  $("mfStart").value = hhmm(startDefault);
  $("mfEnd").value = hhmm(now);

  // side dropdown defaults from current radio selection
  $("mfSide").value = currentSide() ?? "";
  $("mfNotes").value = "manual";

  $("manualModal").classList.remove("hidden");
  $("mfStart").focus();
}

function closeManualModal() {
  $("manualModal").classList.add("hidden");
}

async function saveManualFromModal() {
  const dateStr = $("mfDate").value;
  const startStr = $("mfStart").value;
  const endStr = $("mfEnd").value;
  const side = $("mfSide").value || null;
  const notes = $("mfNotes").value || "";

  if (!dateStr || !startStr || !endStr) {
    alert("Please choose date, start time, and end time.");
    return;
  }

  const startTs = parseLocalDateTime(dateStr, startStr);
  let endTs = parseLocalDateTime(dateStr, endStr);

  if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
    alert("Invalid date/time.");
    return;
  }

  // Crossing midnight handling
  if (endTs <= startTs) endTs += 24 * 60 * 60 * 1000;

  await addEvent({
    type: "feed",
    startTs,
    endTs,
    side,
    notes
  });

  closeManualModal();
  await refresh();
}

function bindManualModal() {
  // open
  $("manualFeedBtn").addEventListener("click", openManualModal);

  // close buttons
  $("manualCloseBtn").addEventListener("click", closeManualModal);
  $("manualCancelBtn").addEventListener("click", closeManualModal);

  // click outside modal to close
  $("manualModal").addEventListener("click", (e) => {
    if (e.target === $("manualModal")) closeManualModal();
  });

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("manualModal").classList.contains("hidden")) {
      closeManualModal();
    }
  });

  // save
  $("manualSaveBtn").addEventListener("click", saveManualFromModal);

  // Enter key saves if focus is inside modal inputs
  ["mfDate", "mfStart", "mfEnd", "mfSide", "mfNotes"].forEach(id => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveManualFromModal();
    });
  });
}

async function lastOfTypes(types) {
  const events = await listEvents(300);
  return events.find(e => types.includes(e.type)) || null;
}

async function renderStatus() {
  const lastFeed = await lastOfTypes(["feed"]);
  const lastDiaper = await lastOfTypes(["wet", "soiled", "both"]);

  $("lastFeed").textContent = lastFeed
    ? (lastFeed.endTs
        ? `${fmtTime(lastFeed.startTs)} (${durationMs(lastFeed.startTs, lastFeed.endTs)})` + (lastFeed.side ? ` [${lastFeed.side}]` : "")
        : `${fmtTime(lastFeed.startTs)} (in progress)` + (lastFeed.side ? ` [${lastFeed.side}]` : ""))
    : "—";

  $("lastDiaper").textContent = lastDiaper
    ? `${fmtTime(lastDiaper.startTs)} (${lastDiaper.type})`
    : "—";

  const activeId = getActiveFeedId();
  $("activeFeed").textContent = activeId ? `#${activeId}` : "none";

  $("feedToggleBtn").textContent = activeId ? "⏹️ Stop Feed" : "▶️ Start Feed";
}

function typeLabel(t) {
  if (t === "feed") return "🍼 Feed";
  if (t === "wet") return "💧 Wet";
  if (t === "soiled") return "💩 Soiled";
  if (t === "both") return "💧💩 Both";
  return t;
}

async function renderHistory() {
  const events = await listEvents(300);
  if (!events.length) {
    $("history").textContent = "No entries yet.";
    return;
  }

  let html = "";
  let lastDayKey = null;

  for (const e of events) {
    const dk = dayKeyFromTsLocal(e.startTs); // local day
    if (dk !== lastDayKey) {
      html += `<div class="dayHeader">${fmtDay(e.startTs)}</div>`;
      lastDayKey = dk;
    }

    const when = fmtTime(e.startTs);
    let detail = "";
    if (e.type === "feed") {
      detail = e.endTs ? `Duration: ${durationMs(e.startTs, e.endTs)}` : "In progress";
      if (e.side) detail += ` • Side: ${e.side}`;
      if (e.notes) detail += ` • Notes: ${e.notes}`;
    } else {
      if (e.notes) detail = `Notes: ${e.notes}`;
    }

    html += `
      <div class="item">
        <div class="itemTop">
          <div><strong>${typeLabel(e.type)}</strong></div>
          <div class="tag">${when}</div>
        </div>
        ${detail ? `<div class="tag">${detail}</div>` : ""}
        <div class="itemBottom">
          <div class="tag">#${e.id}</div>
          <button class="btn btn-secondary" data-del="${e.id}" style="padding:8px 10px;font-size:14px;">Delete</button>
        </div>
      </div>
    `;
  }

  $("history").innerHTML = html;

  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-del"));
      if (getActiveFeedId() === id) setActiveFeed(null);
      await deleteEvent(id);
      await refresh();
    });
  });
}

function eventsToCsv(events) {
  const header = ["id", "type", "startTs", "endTs", "side", "notes"];
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = events.map(e => header.map(k => escape(e[k])).join(","));
  return header.join(",") + "\n" + rows.join("\n");
}


function parseCsv(text) {
  // Minimal CSV parser supporting quotes and commas (matches export format)
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const header = parseLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => obj[h] = cols[idx] ?? "");
    rows.push(obj);
  }
  return rows;
}

function csvRowToEvent(r) {
  // Expected export header: id,type,startTs,endTs,side,notes
  const type = String(r.type ?? "").trim();
  const allowed = new Set(["feed", "wet", "soiled", "both"]);
  if (!allowed.has(type)) return null;

  const startTs = Number(String(r.startTs ?? "").trim());
  if (!Number.isFinite(startTs) || startTs <= 0) return null;

  const endTsRaw = String(r.endTs ?? "").trim();
  const endTs = endTsRaw === "" ? null : Number(endTsRaw);
  const side = String(r.side ?? "").trim();
  const notes = String(r.notes ?? "");

  const idRaw = String(r.id ?? "").trim();
  const id = idRaw === "" ? null : Number(idRaw);

  const ev = { type, startTs, endTs, side, notes };
  if (Number.isFinite(id) && id > 0) ev.id = id; // keep original id when possible
  return ev;
}

async function importCsvFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const ev = csvRowToEvent(r);
    if (!ev) { failed++; continue; }

    try {
      await addEvent(ev);
      imported++;
    } catch (e) {
      // Likely duplicate id (ConstraintError). Skip.
      skipped++;
    }
  }

  await refresh();
  alert(`Restore complete. Imported: ${imported}, skipped (duplicates): ${skipped}, invalid rows: ${failed}`);
}

async function exportCsv() {
  const events = await listEvents(5000);
  const csv = eventsToCsv([...events].reverse()); // oldest first

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `babylog_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function refresh() {
  await renderStatus();
    await renderDailyStatus();
await renderHistory();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    console.warn("SW register failed", e);
  }
}

function bindUi() {
  $("wetBtn").addEventListener("click", () => logDiaper("wet"));
  $("soiledBtn").addEventListener("click", () => logDiaper("soiled"));
  $("bothBtn").addEventListener("click", () => logDiaper("both"));
  $("undoBtn").addEventListener("click", undoLast);

  $("feedToggleBtn").addEventListener("click", async () => {
    const active = getActiveFeedId();
    if (active) await stopFeed();
    else await startFeed();
  });

  $("exportBtn").addEventListener("click", exportCsv);

  // Restore from CSV (same columns as export)
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const ok = confirm("Restore from CSV? Existing entries will be kept; duplicates (same id) will be skipped.");
    if (!ok) { e.target.value = ""; return; }
    await importCsvFile(file);
    e.target.value = "";
  });

  $("clearBtn").addEventListener("click", async () => {
    const ok = confirm("Clear ALL entries? This cannot be undone.");
    if (!ok) return;
    setActiveFeed(null);
    await clearAll();
    await refresh();
  });

  bindManualModal();
}

await (async function main() {
  bindUi();
  await refresh();
  await registerServiceWorker();
})();

// ---- DAILY_STATS_START ----
// Wet/Soiled diapers + Feeds counters for *today* (local time)
function todayKeyLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayKeyFromTsLocal(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getTodayCounts() {
  // Pull enough rows for a day; safe even if list is larger.
  const events = await listEvents(5000);
  const todayKey = todayKeyLocal();

  let feeds = 0;
  let wet = 0;
  let soiled = 0;

  for (const e of events) {
    if (dayKeyFromTsLocal(e.startTs) !== todayKey) continue;

    if (e.type === "feed") feeds++;
    if (e.type === "wet") wet++;
    if (e.type === "soiled") soiled++;
    if (e.type === "both") {
      wet++;
      soiled++;
    }
  }

  return { feeds, wet, soiled };
}

async function renderDailyStatus() {
  const box = document.getElementById("dailyStats");
  if (!box) return;

  const { feeds, wet, soiled } = await getTodayCounts();

  box.innerHTML = `
    <div class="statItem">
      <div class="statValue">${wet}</div>
      <div class="statLabel">Wet diapers</div>
    </div>
    <div class="statItem">
      <div class="statValue">${soiled}</div>
      <div class="statLabel">Soiled diapers</div>
    </div>
    <div class="statItem">
      <div class="statValue">${feeds}</div>
      <div class="statLabel">Feeds today</div>
    </div>
  `;
}
// ---- DAILY_STATS_END ----
