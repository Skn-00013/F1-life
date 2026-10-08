/* ========= CONFIG ========= */
const API_BASE = "https://api.jolpi.ca/ergast/f1";

const DATA_URLS = {
  timetable: "data/timetable.json",
  drivers: "data/drivers.json",
  constructors: "data/constructors.json"
};

const titles = {
  timetable: "F1 Time Table",
  drivers: "Drivers' Championship",
  constructors: "Constructors' Championship"
};

const CACHE_FRESH_MS = 12 * 60 * 60 * 1000; 
const state = { loaded: { timetable: false, drivers: false, constructors: false } };

document.addEventListener("DOMContentLoaded", () => {
  setupDock();
  showView("timetable");
});

function setupDock() {
  document.querySelectorAll(".dock-item").forEach(btn =>
    btn.addEventListener("click", () => showView(btn.dataset.view))
  );
}

async function showView(view) {
  // FIX 1: Scroll to top instantly when switching views
  window.scrollTo({ top: 0, behavior: 'instant' });

  document.getElementById("page-title").textContent = titles[view];
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("active", s.id === view));
  document.querySelectorAll(".dock-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));

  if (!state.loaded[view]) {
    try {
      await ({ timetable: loadTimetable, drivers: loadDrivers, constructors: loadConstructors })[view]();
      state.loaded[view] = true;
    } catch (e) {
      console.error(e);
      setStatus(view + "-status", "Failed to load data. Check console.");
    }
  }
}

/* ========= FETCH LAYER ========= */

async function fetchJSON(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return JSON.parse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAPI(path) {
  const target = API_BASE + path;
  const attempts = [
    fetchJSON("https://api.allorigins.win/raw?url=" + encodeURIComponent(target), 8000).then(d => ({ d, via: "allorigins" })),
    fetchJSON("https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(target), 8000).then(d => ({ d, via: "codetabs" })),
    fetchJSON(target, 8000).then(d => ({ d, via: "direct" }))
  ];
  const winner = await Promise.any(attempts);
  console.log("Fetched via:", winner.via);
  return winner.d;
}

/* ========= LOCAL CACHE ========= */

function readCache(key) {
  try {
    const raw = localStorage.getItem("f1cache_" + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem("f1cache_" + key, JSON.stringify({ t: Date.now(), data }));
  } catch (e) { }
}

/* ========= HELPERS ========= */

function setStatus(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function escapeHTML(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const sortByDate = (a, b) => safeTime(a.raceDate) - safeTime(b.raceDate);
const sortByPos = (a, b) => (Number(a.position) || 999) - (Number(b.position) || 999);

function render(gridId, rows, cardFn, label, source, sortFn) {
  const grid = document.getElementById(gridId);
  const statusId = gridId.replace("-grid", "-status");
  if (!rows.length) { grid.innerHTML = ""; setStatus(statusId, "No data found."); return; }
  const sorted = rows.slice().sort(sortFn);
  grid.innerHTML = sorted.map(cardFn).join("");
  setStatus(statusId, `${source} • ${sorted.length} ${label}`);
}

/* ========= SMART LOADER ========= */

async function loadSmart(cfg) {
  const statusId = cfg.gridId.replace("-grid", "-status");

  const cached = readCache(cfg.key);
  if (cached && cached.data?.length && (Date.now() - cached.t) < CACHE_FRESH_MS) {
    render(cfg.gridId, cached.data, cfg.cardFn, cfg.label, "Cached live data", cfg.sortFn);
  } else {
    try {
      const local = await fetchJSON(cfg.localUrl, 3000);
      render(cfg.gridId, Array.isArray(local) ? local : [], cfg.cardFn, cfg.label, "Local data", cfg.sortFn);
    } catch (e) {
      setStatus(statusId, "Waiting for live data...");
    }
  }

  try {
    const live = await cfg.fetchLive();
    if (live && live.length) {
      writeCache(cfg.key, live);
      render(cfg.gridId, live, cfg.cardFn, cfg.label, "Live API", cfg.sortFn);
    }
  } catch (e) {
    console.warn("Live update skipped for", cfg.key, "-", e?.message);
  }
}

/* ========= NORMALIZERS ========= */

const iso = (d, t) => (d ? (t ? d + "T" + t : d + "T12:00:00Z") : null);

function normalizeApiRaces(data) {
  return (data?.MRData?.RaceTable?.Races || []).map(r => ({
    round: r.round, name: r.raceName,
    circuit: r.Circuit?.circuitName || "", country: r.Circuit?.Location?.country || "",
    raceDate: iso(r.date, r.time),
    practice1Date: iso(r.FirstPractice?.date, r.FirstPractice?.time),
    practice2Date: iso(r.SecondPractice?.date, r.SecondPractice?.time),
    practice3Date: iso(r.ThirdPractice?.date, r.ThirdPractice?.time),
    qualifyingDate: iso(r.Qualifying?.date, r.Qualifying?.time),
    sprintDate: iso(r.Sprint?.date, r.Sprint?.time)
  }));
}

function normalizeApiDrivers(standingsData, lastRaceData) {
  const standings = standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const lastResults = lastRaceData?.MRData?.RaceTable?.Races?.[0]?.Results || [];
  const lastPoints = new Map();
  lastResults.forEach(r => { if (r.Driver?.driverId) lastPoints.set(r.Driver.driverId, Number(r.points || 0)); });
  return standings.map(item => {
    const d = item.Driver || {};
    return {
      position: item.position,
      name: `${d.givenName || ""} ${d.familyName || ""}`.trim() || "Unknown Driver",
      team: item.Constructors?.[0]?.name || "",
      points: Number(item.points || 0),
      lastGpChange: lastPoints.has(d.driverId) ? lastPoints.get(d.driverId) : null,
      image: ""
    };
  });
}

function normalizeApiConstructors(data) {
  const standings = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  return standings.map(item => {
    const c = item.Constructor || {};
    return { position: item.position, name: c.name || "Unknown Constructor", nationality: c.nationality || "", points: Number(item.points || 0), image: "" };
  });
}

/* ========= LOADERS ========= */

function loadTimetable() {
  return loadSmart({
    key: "timetable", localUrl: DATA_URLS.timetable, gridId: "timetable-grid",
    cardFn: createRaceCard, label: "rounds", sortFn: sortByDate,
    fetchLive: async () => normalizeApiRaces(await fetchAPI("/current.json"))
  });
}

function loadDrivers() {
  return loadSmart({
    key: "drivers", localUrl: DATA_URLS.drivers, gridId: "drivers-grid",
    cardFn: createDriverCard, label: "drivers", sortFn: sortByPos,
    fetchLive: async () => {
      const [st, lr] = await Promise.all([ fetchAPI("/current/driverStandings.json"), fetchAPI("/current/last/results.json").catch(() => null) ]);
      return normalizeApiDrivers(st, lr);
    }
  });
}

function loadConstructors() {
  return loadSmart({
    key: "constructors", localUrl: DATA_URLS.constructors, gridId: "constructors-grid",
    cardFn: createConstructorCard, label: "teams", sortFn: sortByPos,
    fetchLive: async () => normalizeApiConstructors(await fetchAPI("/current/constructorStandings.json"))
  });
}

/* ========= CARDS ========= */

function createRaceCard(race) {
  const finished = isRaceFinished(race.raceDate);
  const sessions = [
    ["GP", race.raceDate, true], ["Practice 1", race.practice1Date, false],
    ["Practice 2", race.practice2Date, false], ["Practice 3", race.practice3Date, false],
    ["Qualifying", race.qualifyingDate, false], ["Sprint", race.sprintDate, false]
  ];
  return `
    <article class="card race-card ${finished ? "finished" : ""}">
      <div class="card-header">
        <h3>${escapeHTML(race.name || "Grand Prix")}</h3>
        <span class="badge">Round ${escapeHTML(race.round || "-")}</span>
      </div>
      <p class="subtle">${escapeHTML(race.circuit || "")}${race.country ? ", " + escapeHTML(race.country) : ""}</p>
      <p class="tz-note">All times local (${getTimeZoneName(race.raceDate)})</p>
      ${sessions.map(([label, d, strong]) => sessionLine(label, d, strong)).join("")}
    </article>`;
}

function sessionLine(label, d, strong) {
  if (!d) return "";
  return `<p class="session ${strong ? "strong" : ""}"><span class="s-label">${label}</span><span class="s-date">${formatDate(d)}</span><time class="s-time">${formatTime(d)}</time></p>`;
}

function formatDate(d) {
  if (!d) return "TBA";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  try { return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(date); } 
  catch (e) { return date.toLocaleDateString(); }
}

function formatTime(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date); } 
  catch (e) { return date.toLocaleTimeString(); }
}

function getTimeZoneName(d) {
  const date = d ? new Date(d) : new Date();
  if (Number.isNaN(date.getTime())) return "local time";
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(date).find(p => p.type === "timeZoneName");
    return part ? part.value : "local time";
  } catch (e) { return "local time"; }
}

function safeTime(d) { if (!d) return 0; const t = new Date(d).getTime(); return Number.isNaN(t) ? 0 : t; }
function isRaceFinished(d) { return safeTime(d) > 0 && safeTime(d) < Date.now(); }

function createDriverCard(driver) {
  const name = driver.name || "Unknown Driver";
  const pos = Number(driver.position) || 0;
  const change = Number(driver.lastGpChange);
  let changeClass = "neutral", changeText = "0";
  if (!Number.isNaN(change)) {
    if (change > 0) { changeClass = "positive"; changeText = "+" + change; }
    else if (change < 0) { changeClass = "negative"; changeText = "" + change; }
    else { changeText = "0"; }
  } else { changeText = "–"; }

  return `
    <article class="card driver-card">
      <span class="pos ${pos <= 3 ? "top" : ""}">${escapeHTML(driver.position || "-")}</span>
      <img src="${escapeHTML(getImageWithFallback(driver.image, name))}" alt="${escapeHTML(name)}" loading="lazy" />
      <div class="driver-info">
        <h3>${escapeHTML(name)}</h3>
        <p class="subtle">${escapeHTML(driver.team || "")}</p>
      </div>
      <div class="card-stats">
        <p class="points">${Number(driver.points || 0)}<span class="pts">pts</span></p>
        <p class="change ${changeClass}">${changeText}<span class="chg-label">last GP</span></p>
      </div>
    </article>`;
}

function createConstructorCard(c) {
  const name = c.name || "Unknown Constructor";
  const pos = Number(c.position) || 0;
  return `
    <article class="card constructor-card">
      <span class="pos ${pos <= 3 ? "top" : ""}">${escapeHTML(c.position || "-")}</span>
      <img src="${escapeHTML(getImageWithFallback(c.image, name))}" alt="${escapeHTML(name)}" loading="lazy" />
      <div class="constructor-info">
        <h3>${escapeHTML(name)}</h3>
        <p class="subtle">${escapeHTML(c.nationality || "")}</p>
      </div>
      <div class="card-stats">
        <p class="points">${Number(c.points || 0)}<span class="pts">pts</span></p>
      </div>
    </article>`;
}

/* ========= IMAGES ========= */

function getImageWithFallback(path, name) {
  if (path) return path;
  const initials = (String(name).trim().split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join("")) || "F1";
  const safe = initials.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="24" fill="#e5e7eb"/><text x="72" y="78" text-anchor="middle" font-family="Arial" font-size="44" font-weight="700" fill="#374151">${safe}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}