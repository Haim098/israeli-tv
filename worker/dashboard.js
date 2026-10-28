// The usage dashboard, served by the worker at /stats. Reads /api/stats.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>טלוויזיה חיה · סטטיסטיקות</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0b0d12; --panel: #141821; --panel2: #1b2030; --border: #262c3b;
    --text: #e8ebf2; --muted: #8b93a7; --accent: #4f8cff; --green: #34d399;
    --amber: #fbbf24; --red: #f87171; --purple: #a78bfa;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Rubik, Arial, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 18px 20px 6px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0; font-weight: 700; }
  .upd { color: var(--muted); font-size: 12px; }
  main { max-width: 1200px; margin: 0 auto; padding: 8px 16px 40px; display: grid; gap: 14px;
    grid-template-columns: repeat(12, 1fr); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px;
    min-width: 0; }
  .card h2 { font-size: 14px; color: var(--muted); font-weight: 600; margin: 0 0 10px; }
  .kpi { grid-column: span 3; }
  .kpi .v { font-size: 34px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .kpi .s { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .live .v { color: var(--green); display: flex; align-items: center; gap: 10px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--green);
    box-shadow: 0 0 0 0 rgba(52,211,153,.7); animation: pulse 1.8s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); } 70% { box-shadow: 0 0 0 10px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }
  .w4 { grid-column: span 4; } .w5 { grid-column: span 5; } .w6 { grid-column: span 6; }
  .w7 { grid-column: span 7; } .w8 { grid-column: span 8; } .w12 { grid-column: span 12; }
  .chart { position: relative; height: 240px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: right; padding: 7px 6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; }
  td.wrap { white-space: normal; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: var(--panel2); }
  .k-error, .k-gave_up { color: var(--red); } .k-fallback, .k-stall { color: var(--amber); }
  .k-recovered, .k-returned { color: var(--green); }
  .empty { color: var(--muted); font-size: 13px; padding: 18px 0; text-align: center; }
  .chlist { display: grid; gap: 8px; }
  .chrow { display: grid; grid-template-columns: 90px 1fr 34px; align-items: center; gap: 10px; font-size: 13px; }
  .bar { height: 10px; background: var(--panel2); border-radius: 99px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .5s; }
  .num { text-align: left; font-variant-numeric: tabular-nums; color: var(--muted); }
  .scroll { overflow-x: auto; }
  @media (max-width: 900px) {
    .kpi { grid-column: span 6; } .w4, .w5, .w6, .w7, .w8 { grid-column: span 12; }
  }
</style>
</head>
<body>
<header>
  <h1>טלוויזיה חיה · סטטיסטיקות שימוש</h1>
  <div class="upd" id="upd">טוען…</div>
</header>
<main>
  <div class="card kpi live"><h2>מחוברים עכשיו</h2><div class="v"><span class="dot"></span><span id="k-online">–</span></div><div class="s" id="k-online-s"></div></div>
  <div class="card kpi"><h2>מבקרים היום</h2><div class="v" id="k-visitors">–</div><div class="s" id="k-visitors-s"></div></div>
  <div class="card kpi"><h2>שיא מחוברים היום</h2><div class="v" id="k-peak">–</div><div class="s" id="k-peak-s"></div></div>
  <div class="card kpi"><h2>זמן צפייה היום</h2><div class="v" id="k-watch">–</div><div class="s" id="k-watch-s"></div></div>

  <div class="card w4"><h2>מה רואים עכשיו</h2><div id="now-ch" class="chlist"></div></div>
  <div class="card w8"><h2>מחוברים ב-24 השעות האחרונות</h2><div class="chart"><canvas id="c-timeline"></canvas></div></div>

  <div class="card w7"><h2>מבקרים וכניסות לפי יום (30 יום)</h2><div class="chart"><canvas id="c-daily"></canvas></div></div>
  <div class="card w5"><h2>זמן צפייה לפי ערוץ (30 יום, שעות)</h2><div class="chart"><canvas id="c-channels"></canvas></div></div>

  <div class="card w4"><h2>מכשירים (30 יום)</h2><div class="chart"><canvas id="c-platform"></canvas></div></div>
  <div class="card w4"><h2>מדינות (30 יום)</h2><div class="chart"><canvas id="c-country"></canvas></div></div>
  <div class="card w4"><h2>תקלות לפי יום (14 יום)</h2><div class="chart"><canvas id="c-problems"></canvas></div></div>

  <div class="card w12"><h2>צופים מחוברים כרגע</h2><div class="scroll" id="viewers"></div></div>
  <div class="card w12"><h2>תקלות אחרונות</h2><div class="scroll" id="events"></div></div>
</main>
<script>
const CH = { kan11: 'כאן 11', keshet12: 'קשת 12', reshet13: 'רשת 13', channel14: 'ערוץ 14',
  channel16: 'ערוץ 16', i24news: 'i24 NEWS', knesset: 'ערוץ הכנסת' };
const KIND = { error: 'שגיאת שידור', fallback: 'עבר לאתר הערוץ', gave_up: 'ויתר, הוצגה שגיאה',
  stall: 'השידור נתקע', recovered: 'התאושש', returned: 'חזר לשידור הישיר' };
const PLAT = { android: 'אנדרואיד', ios: 'אייפון / אייפד', desktop: 'מחשב', other: 'אחר' };
const COLORS = ['#4f8cff', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#94a3b8'];
const chName = (id) => CH[id] || id || 'לא ידוע';
const region = (() => { try { return new Intl.DisplayNames(['he'], { type: 'region' }); } catch { return null; } })();
const countryName = (c) => { try { return (region && c && c !== '??' && region.of(c)) || 'לא ידוע'; } catch { return c; } };
const fmtH = (secs) => secs >= 3600 ? (secs / 3600).toFixed(1) + ' שע׳' : Math.round(secs / 60) + ' דק׳';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = 'Asia/Jerusalem';
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const dtFmt = new Intl.DateTimeFormat('he-IL', { timeZone: tz, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayLabel = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);

Chart.defaults.color = '#8b93a7';
Chart.defaults.borderColor = '#262c3b';
Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Rubik, Arial, sans-serif';
const charts = {};
function chart(id, cfg) {
  if (charts[id]) { charts[id].data = cfg.data; charts[id].update('none'); return; }
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { labels: { boxWidth: 12 } } } }, cfg.options || {});
  charts[id] = new Chart(document.getElementById(id), cfg);
}

function lastDays(today, n) {
  const out = []; const t = new Date(today + 'T12:00:00Z');
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 86400e3).toISOString().slice(0, 10));
  return out;
}

function render(d) {
  const by = {};
  for (const r of d.counters) (by[r.day] ||= {})[r.key] = r.n;
  const today = by[d.today] || {};
  const yest = by[lastDays(d.today, 2)[0]] || {};

  document.getElementById('k-online').textContent = d.online;
  document.getElementById('k-online-s').textContent = d.watching + ' צופים בשידור כרגע';
  document.getElementById('k-visitors').textContent = today.visitors || 0;
  document.getElementById('k-visitors-s').textContent = (today.sessions || 0) + ' כניסות · אתמול ' + (yest.visitors || 0) + ' מבקרים';
  document.getElementById('k-peak').textContent = today.peak_online || d.online;
  document.getElementById('k-peak-s').textContent = 'אתמול ' + (yest.peak_online || 0);
  const liveSecs = Object.values(d.liveWatch).reduce((a, b) => a + b, 0);
  document.getElementById('k-watch').textContent = fmtH((today.watch || 0) + liveSecs);
  document.getElementById('k-watch-s').textContent = 'אתמול ' + fmtH(yest.watch || 0);

  // Now watching, per channel
  const now = {};
  for (const v of d.viewers) { const k = v.ch || '?'; now[k] = (now[k] || 0) + 1; }
  const nowRows = Object.entries(now).sort((a, b) => b[1] - a[1]);
  const maxNow = Math.max(1, ...nowRows.map((r) => r[1]));
  document.getElementById('now-ch').innerHTML = nowRows.length
    ? nowRows.map(([ch, n]) => '<div class="chrow"><span>' + esc(chName(ch)) + '</span><div class="bar"><i style="width:' + (n / maxNow * 100) + '%"></i></div><span class="num">' + n + '</span></div>').join('')
    : '<div class="empty">אין כרגע מחוברים</div>';

  // Timeline (step line), extended to now
  const pts = d.timeline.map((r) => ({ x: Math.max(r.ts, d.now - 24 * 3600e3), o: r.online, w: r.watching }));
  if (pts.length) pts.push({ x: d.now, o: d.online, w: d.watching });
  chart('c-timeline', { type: 'line',
    data: { datasets: [
      { label: 'מחוברים', data: pts.map((p) => ({ x: p.x, y: p.o })), stepped: true, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.12)', fill: true, pointRadius: 0, borderWidth: 2 },
      { label: 'צופים בשידור', data: pts.map((p) => ({ x: p.x, y: p.w })), stepped: true, borderColor: '#4f8cff', pointRadius: 0, borderWidth: 2 },
    ] },
    options: { parsing: true, scales: {
      x: { type: 'linear', min: d.now - 24 * 3600e3, max: d.now, ticks: { maxTicksLimit: 8, callback: (v) => timeFmt.format(new Date(v)) } },
      y: { beginAtZero: true, ticks: { precision: 0 } } } } });

  // Daily visitors / sessions
  const days30 = lastDays(d.today, 30);
  chart('c-daily', { type: 'bar',
    data: { labels: days30.map(dayLabel), datasets: [
      { label: 'מבקרים', data: days30.map((x) => (by[x] || {}).visitors || 0), backgroundColor: '#4f8cff', borderRadius: 4 },
      { label: 'כניסות', data: days30.map((x) => (by[x] || {}).sessions || 0), backgroundColor: 'rgba(167,139,250,.55)', borderRadius: 4 },
    ] },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });

  // Watch time per channel (30 days, incl. live)
  const watch = {};
  for (const r of d.counters) if (r.key.startsWith('watch:')) { const c = r.key.slice(6); watch[c] = (watch[c] || 0) + r.n; }
  for (const [c, s] of Object.entries(d.liveWatch)) watch[c] = (watch[c] || 0) + s;
  const wRows = Object.entries(watch).sort((a, b) => b[1] - a[1]);
  chart('c-channels', { type: 'bar',
    data: { labels: wRows.map((r) => chName(r[0])), datasets: [{ label: 'שעות', data: wRows.map((r) => +(r[1] / 3600).toFixed(2)), backgroundColor: COLORS, borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } } });

  // Platform / country
  const sum = (prefix) => { const o = {}; for (const r of d.counters) if (r.key.startsWith(prefix)) { const k = r.key.slice(prefix.length); o[k] = (o[k] || 0) + r.n; } return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const plat = sum('platform:');
  chart('c-platform', { type: 'doughnut',
    data: { labels: plat.map((r) => PLAT[r[0]] || r[0]), datasets: [{ data: plat.map((r) => r[1]), backgroundColor: COLORS, borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'bottom' } } } });
  const ctry = sum('country:').slice(0, 7);
  chart('c-country', { type: 'doughnut',
    data: { labels: ctry.map((r) => countryName(r[0])), datasets: [{ data: ctry.map((r) => r[1]), backgroundColor: COLORS, borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'bottom' } } } });

  // Problems per day by kind
  const days14 = lastDays(d.today, 14);
  const kinds = ['error', 'stall', 'fallback', 'gave_up'];
  const kc = { error: '#f87171', stall: '#fbbf24', fallback: '#fb923c', gave_up: '#a78bfa' };
  chart('c-problems', { type: 'bar',
    data: { labels: days14.map(dayLabel), datasets: kinds.map((k) => ({ label: KIND[k], data: days14.map((x) => (by[x] || {})['problem:' + k] || 0), backgroundColor: kc[k], borderRadius: 3 })) },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } } });

  // Viewers table
  document.getElementById('viewers').innerHTML = d.viewers.length
    ? '<table><tr><th>ערוץ</th><th>מצב</th><th>מכשיר</th><th>מדינה</th><th>רשת</th><th>מחובר</th></tr>' +
      d.viewers.sort((a, b) => b.minutes - a.minutes).map((v) => '<tr><td>' + esc(chName(v.ch)) + '</td><td>' + (v.playing ? '<span class="tag" style="color:#34d399">צופה</span>' : '<span class="tag">לא מנגן</span>') + '</td><td>' + esc(PLAT[v.platform] || v.platform) + '</td><td>' + esc(countryName(v.country)) + '</td><td>' + esc(v.isp || '') + '</td><td>' + v.minutes + ' דק׳</td></tr>').join('') + '</table>'
    : '<div class="empty">אין כרגע מחוברים</div>';

  // Events table
  document.getElementById('events').innerHTML = d.events.length
    ? '<table><tr><th>זמן</th><th>ערוץ</th><th>מה קרה</th><th>פרטים</th><th>קוד</th><th>שרת</th><th>רשת</th><th>מכשיר</th></tr>' +
      d.events.map((e) => '<tr><td>' + dtFmt.format(new Date(e.ts)) + '</td><td>' + esc(chName(e.channel)) + '</td><td class="k-' + esc(e.kind) + '">' + esc(KIND[e.kind] || e.kind) + '</td><td class="wrap">' + esc(e.detail) + '</td><td>' + esc(e.status ?? '') + '</td><td>' + esc(e.host) + '</td><td>' + esc(e.isp) + (e.country ? ' (' + esc(e.country) + ')' : '') + '</td><td>' + esc(PLAT[e.platform] || e.platform || '') + '</td></tr>').join('') + '</table>'
    : '<div class="empty">אין תקלות מתועדות</div>';

  document.getElementById('upd').textContent = 'עודכן ' + timeFmt.format(new Date(d.now));
}

const qs = location.search;
async function load() {
  try {
    const r = await fetch('/api/stats' + qs, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch (e) {
    document.getElementById('upd').textContent = 'שגיאה בטעינה, מנסה שוב…';
  }
}
load();
setInterval(() => { if (!document.hidden) load(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;
