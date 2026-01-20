// stats.js
console.log("Statistics page loaded");
let entries = [];

let currentView = 'daily';


function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function loadAllRecords() {
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  if (!dbs.length) {
    console.warn("No IndexedDB databases found");
    return [];
  }

  // Assume first DB is the app DB (confirmed in Step 3)
  const dbName = dbs[0].name;
  const db = await reqToPromise(indexedDB.open(dbName));

  // Assume first store is the events store (confirmed in Step 3)
  const storeName = db.objectStoreNames[0];
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);

  const records = await reqToPromise(store.getAll());
  db.close();

  return records;
}

function normalize(records) {
  const days = {};

  for (const r of records) {
    const { type, startTs, endTs } = r;
    if (!startTs) continue;

    const day = dayKey(startTs);

    days[day] ??= {
      feeds: [],
      diapers: { wet: 0, soiled: 0, both: 0 },
      feedMinutes: 0,
    };

    // Feed
    if (type === "feed") {
      const minutes =
        endTs && endTs > startTs
          ? (endTs - startTs) / 60000
          : 0;

      days[day].feeds.push({
        startTs,
        endTs,
        minutes,
        side: r.side || null,
      });

      days[day].feedMinutes += minutes;
    }

    // Diaper
    if (type === "wet" || type === "soiled" || type === "both") {
      days[day].diapers[type]++;
    }
  }

  return days;
}


(async function run() {
  const records = await loadAllRecords();
  const dailyStats = normalize(records);
  // Expose for next steps
  window.__STATS__ = dailyStats;
  renderStats(dailyStats);
})();

function renderStats(days) {
  const container = document.getElementById("statsContainer");
  container.innerHTML = "";

  const sortedDays = Object.keys(days).sort().reverse();

  for (const day of sortedDays) {
    const d = days[day];

    const card = document.createElement("section");
    card.className = "card";

    card.innerHTML = `
      <div class="dayHeader">${day}</div>

      <div class="dailyStats">
        <div class="statItem">
          <div class="statValue">${d.feeds.length}</div>
          <div class="statLabel">Feeds</div>
        </div>

        <div class="statItem">
          <div class="statValue">${Math.round(d.feedMinutes)}</div>
          <div class="statLabel">Minutes</div>
        </div>

        <div class="statItem">
          <div class="statValue">
            ${d.diapers.wet}/${d.diapers.soiled}/${d.diapers.both}
          </div>
          <div class="statLabel">Wet / Soiled / Both</div>
        </div>
      </div>
    `;

    container.appendChild(card);
  }
}

const tabs = document.querySelectorAll('#statsTabs button');
const statsContainer = document.getElementById('statsContainer');

tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    // update button styles
    tabs.forEach(b => b.classList.remove('btn-primary'));
    btn.classList.add('btn-primary');

    const view = btn.dataset.view;

    if (view === 'daily') {
      location.reload();
    }

    if (view === 'weekly') {
      renderWeeklyStats();
    }

    if (view === 'monthly') {
      renderMonthlyStats();
    }

  });
});


function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  // ISO week (Monday-based)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(
    ((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  );

  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getMonthKey(dayKey) {
  // dayKey = YYYY-MM-DD
  return dayKey.slice(0, 7); // YYYY-MM
}


function buildWeeklyFromDaily(days) {
  const weeks = {};

  for (const day in days) {
    const week = getWeekKey(day);
    const d = days[day];

    weeks[week] ??= {
      feeds: 0,
      wet: 0,
      soiled: 0,
      both: 0,
      minutes: 0,
      days: 0
    };

    weeks[week].feeds += d.feeds.length;
    weeks[week].wet += d.diapers.wet;
    weeks[week].soiled += d.diapers.soiled;
    weeks[week].both += d.diapers.both;
    weeks[week].minutes += d.feedMinutes;
    weeks[week].days += 1;
  }

  return weeks;
}

function buildMonthlyFromDaily(days) {
  const months = {};

  for (const day in days) {
    const month = getMonthKey(day);
    const d = days[day];

    months[month] ??= {
      feeds: 0,
      wet: 0,
      soiled: 0,
      both: 0,
      minutes: 0,
      days: 0,
    };

    months[month].feeds += d.feeds.length;
    months[month].wet += d.diapers.wet;
    months[month].soiled += d.diapers.soiled;
    months[month].both += d.diapers.both;
    months[month].minutes += d.feedMinutes;
    months[month].days += 1;
  }

  return months;
}


function renderWeeklyStats() {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '';

  const days = window.__STATS__;

  if (!days) {
    statsContainer.innerHTML = `
      <div class="card">
        <p class="hint">Stats not ready yet</p>
      </div>
    `;
    return;
  }

  const weekly = buildWeeklyFromDaily(days);
  const weeks = Object.keys(weekly).sort().reverse();

  if (!weeks.length) {
    statsContainer.innerHTML = `
      <div class="card">
        <p class="hint">No data yet</p>
      </div>
    `;
    return;
  }

  weeks.forEach(week => {
    const w = weekly[week];

    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
  <strong>${getWeekRangeLabel(week)}</strong>

  <div class="dailyStats">
    <div class="statItem">
      <div class="statValue">${w.feeds}</div>
      <div class="statLabel">
        Feeds<br>
        <small>${(w.feeds / w.days).toFixed(1)}/day</small>
      </div>
    </div>

    <div class="statItem">
      <div class="statValue">${Math.round(w.minutes)}</div>
      <div class="statLabel">
        Minutes<br>
        <small>${Math.round(w.minutes / w.days)}/day</small>
      </div>
    </div>

    <div class="statItem">
      <div class="statValue">
        ${w.wet}/${w.soiled}/${w.both}
      </div>
      <div class="statLabel">Wet / Soiled / Both</div>
    </div>
  </div>
`;


    statsContainer.appendChild(card);
  });
}

function renderMonthlyStats() {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '';

  const days = window.__STATS__;

  if (!days) {
    statsContainer.innerHTML = `
      <div class="card">
        <p class="hint">Stats not ready yet</p>
      </div>
    `;
    return;
  }

  const monthly = buildMonthlyFromDaily(days);
  const months = Object.keys(monthly).sort().reverse();

  if (!months.length) {
    statsContainer.innerHTML = `
      <div class="card">
        <p class="hint">No data yet</p>
      </div>
    `;
    return;
  }

  months.forEach(month => {
    const m = monthly[month];

    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <strong>${getMonthLabel(month)}</strong>

      <div class="dailyStats">
        <div class="statItem">
          <div class="statValue">${m.feeds}</div>
          <div class="statLabel">
            Feeds<br>
            <small>${(m.feeds / m.days).toFixed(1)}/day</small>
          </div>
        </div>

        <div class="statItem">
          <div class="statValue">${Math.round(m.minutes)}</div>
          <div class="statLabel">
            Minutes<br>
            <small>${Math.round(m.minutes / m.days)}/day</small>
          </div>
        </div>

        <div class="statItem">
          <div class="statValue">
            ${m.wet}/${m.soiled}/${m.both}
          </div>
          <div class="statLabel">Wet / Soiled / Both</div>
        </div>
      </div>
    `;

    statsContainer.appendChild(card);
  });
}


function getWeekRangeLabel(weekKey) {
  const [year, w] = weekKey.split('-W');
  const week = Number(w);

  // ISO week → Monday
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const weekStart = new Date(simple);
  if (dow <= 4) {
    weekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    weekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const fmt = d =>
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });

  return `${fmt(weekStart)}–${fmt(weekEnd)}`;
}

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1, 1);

  return d.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

