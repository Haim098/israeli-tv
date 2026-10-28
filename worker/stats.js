/**
 * Live viewer count + usage history for the Israeli TV app.
 *
 * One Durable Object ("global") holds:
 * - a WebSocket per open copy of the app (hibernating, so idle sockets cost
 *   nothing). Its attachment says which channel it's on and whether it plays.
 * - SQLite tables with daily counters, unique visitors, the online-count
 *   timeline and recent playback problems.
 *
 * Built to stay inside the free plan's daily quotas (100k rows written,
 * 5M rows read):
 * - tables are WITHOUT ROWID / INTEGER PRIMARY KEY, so a write is one row,
 *   not a row plus an index entry;
 * - the timeline is written at most once a minute, by an alarm;
 * - a reconnect within 30 minutes is the same session and writes nothing;
 * - peaks are written only when they go up;
 * - the dashboard polls a small "live" part often and the heavy history
 *   rarely (and that is memoized for a minute).
 *
 * Nothing personal is stored: a random per-browser id (to count unique
 * visitors), country, network name and platform. No IP addresses.
 */
const TZ = 'Asia/Jerusalem';
const KEEP_DAYS = 45;
const SESSION_GAP_MS = 30 * 60e3; // reconnect within this = same session
const LAST_SEEN_STEP_MS = 5 * 60e3; // refresh "last seen" at most this often
const FULL_CACHE_MS = 60e3;
const PROBLEM_KINDS = ['error', 'fallback', 'gave_up', 'stall', 'recovered', 'returned'];

function dayOf(ts) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
}

const clip = (v, max = 40) => (typeof v === 'string' && v ? v.slice(0, max) : null);

export class Stats {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.peak = null; // { day, online, watching } cache of today's peaks
    this.alarmAt = 0;
    this.fullCache = null;
    ctx.blockConcurrencyWhile(async () => this.migrate());
    // Keep-alive pings from the app are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL,
        PRIMARY KEY (day, key)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, vid TEXT NOT NULL, last INTEGER NOT NULL,
        PRIMARY KEY (day, vid)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS timeline (ts INTEGER PRIMARY KEY, online INTEGER NOT NULL, watching INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (ts INTEGER, kind TEXT, channel TEXT, detail TEXT, status INTEGER,
        host TEXT, country TEXT, isp TEXT, platform TEXT);
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
    `);
    // One-time move from the first version's tables.
    const old = new Set(
      this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name),
    );
    if (old.has('counters')) {
      this.sql.exec("INSERT OR REPLACE INTO daily SELECT day, key, n FROM counters WHERE key NOT IN ('watch', 'session_secs')");
      this.sql.exec('DROP TABLE counters');
    }
    if (old.has('visitors')) {
      this.sql.exec('INSERT OR IGNORE INTO seen SELECT day, vid, 0 FROM visitors');
      this.sql.exec('DROP TABLE visitors');
    }
    if (old.has('online_log')) {
      this.sql.exec('INSERT OR REPLACE INTO timeline SELECT ts, online, watching FROM online_log');
      this.sql.exec('DROP TABLE online_log');
    }
  }

  add(day, key, n = 1) {
    this.sql.exec(
      'INSERT INTO daily (day, key, n) VALUES (?, ?, ?) ON CONFLICT (day, key) DO UPDATE SET n = n + excluded.n',
      day, key, n,
    );
  }

  // Seconds watched since the attachment's last change go to that channel.
  flushWatch(att, now) {
    if (att.playing && att.ch && att.since) {
      const secs = Math.round((now - att.since) / 1000);
      if (secs > 0 && secs < 24 * 3600) this.add(dayOf(now), 'watch:' + att.ch, secs);
    }
    att.since = now;
  }

  sockets(exclude) {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== exclude && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING);
  }

  counts(exclude) {
    const live = this.sockets(exclude);
    let watching = 0;
    for (const ws of live) {
      const a = ws.deserializeAttachment();
      if (a && a.playing) watching++;
    }
    return { online: live.length, watching };
  }

  // Today's peaks, written only when they go up.
  checkPeak(now) {
    const day = dayOf(now);
    if (!this.peak || this.peak.day !== day) {
      const p = { day, online: 0, watching: 0 };
      for (const r of this.sql
        .exec("SELECT key, n FROM daily WHERE day = ? AND key IN ('peak_online', 'peak_watching')", day)
        .toArray()) {
        if (r.key === 'peak_online') p.online = r.n;
        else p.watching = r.n;
      }
      this.peak = p;
    }
    const { online, watching } = this.counts();
    if (online > this.peak.online) {
      this.peak.online = online;
      this.sql.exec("INSERT OR REPLACE INTO daily (day, key, n) VALUES (?, 'peak_online', ?)", day, online);
    }
    if (watching > this.peak.watching) {
      this.peak.watching = watching;
      this.sql.exec("INSERT OR REPLACE INTO daily (day, key, n) VALUES (?, 'peak_watching', ?)", day, watching);
    }
  }

  // Something changed: log the online count at the next minute boundary.
  async scheduleLog() {
    const now = Date.now();
    if (this.alarmAt > now) return;
    const cur = await this.ctx.storage.getAlarm();
    if (cur && cur > now) {
      this.alarmAt = cur;
      return;
    }
    this.alarmAt = Math.ceil((now + 1000) / 60e3) * 60e3;
    await this.ctx.storage.setAlarm(this.alarmAt);
  }

  async alarm() {
    this.alarmAt = 0;
    const now = Date.now();
    const { online, watching } = this.counts();
    const last = this.sql.exec('SELECT online, watching FROM timeline ORDER BY ts DESC LIMIT 1').toArray()[0];
    if (!last || last.online !== online || last.watching !== watching) {
      this.sql.exec(
        'INSERT OR REPLACE INTO timeline (ts, online, watching) VALUES (?, ?, ?)',
        Math.floor(now / 60e3) * 60e3, online, watching,
      );
    }
    if (Math.random() < 0.01) this.prune(now);
  }

  prune(now) {
    const cutoff = now - KEEP_DAYS * 86400e3;
    const cutDay = dayOf(cutoff);
    this.sql.exec('DELETE FROM timeline WHERE ts < ?', cutoff);
    this.sql.exec('DELETE FROM events WHERE ts < ?', cutoff);
    this.sql.exec('DELETE FROM seen WHERE day < ?', cutDay);
    this.sql.exec('DELETE FROM daily WHERE day < ?', cutDay);
  }

  // Counts a visit, unless this browser was here less than 30 minutes ago.
  countVisit(att, now) {
    const day = dayOf(now);
    if (!att.vid) {
      this.add(day, 'sessions');
      return;
    }
    const row = this.sql.exec('SELECT last FROM seen WHERE day = ? AND vid = ?', day, att.vid).toArray()[0];
    if (!row) {
      this.sql.exec('INSERT INTO seen (day, vid, last) VALUES (?, ?, ?)', day, att.vid, now);
      this.add(day, 'sessions');
      this.add(day, 'visitors');
      this.add(day, 'country:' + att.country);
      this.add(day, 'platform:' + att.platform);
    } else if (now - row.last > SESSION_GAP_MS) {
      this.sql.exec('UPDATE seen SET last = ? WHERE day = ? AND vid = ?', now, day, att.vid);
      this.add(day, 'sessions');
    } else if (now - row.last > LAST_SEEN_STEP_MS) {
      this.sql.exec('UPDATE seen SET last = ? WHERE day = ? AND vid = ?', now, day, att.vid);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === '/live') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const p = url.searchParams;
      const cf = request.cf || {};
      const att = {
        vid: clip(p.get('vid'), 24),
        ch: clip(p.get('ch'), 24),
        playing: p.get('pl') === '1',
        since: now,
        start: now,
        platform: clip(p.get('p'), 12) || 'other',
        country: clip(cf.country, 4) || '??',
        isp: clip(cf.asOrganization, 40),
      };
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(att);
      // Stats must never stop the socket from opening.
      try {
        this.countVisit(att, now);
        this.checkPeak(now);
        await this.scheduleLog();
      } catch (e) {
        console.log({ stats_error: String(e).slice(0, 200) });
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/event' && request.method === 'POST') {
      const e = await request.json();
      if (!PROBLEM_KINDS.includes(e.kind)) return new Response(null, { status: 400 });
      this.sql.exec(
        'INSERT INTO events (ts, kind, channel, detail, status, host, country, isp, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        now, e.kind, clip(e.channel), clip(e.detail, 80), Number.isFinite(e.status) ? e.status : null,
        clip(e.host, 80), clip(e.country, 4), clip(e.isp), clip(e.platform, 12),
      );
      const day = dayOf(now);
      this.add(day, 'problem:' + e.kind);
      if (e.channel && e.kind !== 'recovered' && e.kind !== 'returned') this.add(day, 'problem_ch:' + clip(e.channel));
      this.fullCache = null;
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/data') {
      const data =
        url.searchParams.get('part') === 'live'
          ? this.liveSnapshot(now, Number(url.searchParams.get('since')) || 0)
          : this.fullSnapshot(now);
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 300) return;
    let m;
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() || {};
    const ch = typeof m.ch === 'string' ? clip(m.ch, 24) : att.ch;
    const playing = typeof m.pl === 'boolean' ? m.pl : att.playing;
    if (ch === att.ch && playing === att.playing) return; // nothing changed
    const now = Date.now();
    this.flushWatch(att, now);
    att.ch = ch;
    att.playing = playing;
    ws.serializeAttachment(att);
    this.checkPeak(now);
    await this.scheduleLog();
  }

  async closed(ws) {
    const now = Date.now();
    const att = ws.deserializeAttachment();
    if (att) {
      this.flushWatch(att, now);
      // Keep "last seen" fresh so a long visit isn't split into two sessions.
      if (att.vid && now - att.start > LAST_SEEN_STEP_MS) {
        this.sql.exec('UPDATE seen SET last = ? WHERE day = ? AND vid = ?', now, dayOf(now), att.vid);
      }
      ws.serializeAttachment(null);
    }
    await this.scheduleLog();
  }

  async webSocketClose(ws, code) {
    await this.closed(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // already closed
    }
  }

  async webSocketError(ws) {
    await this.closed(ws);
  }

  viewers(now) {
    return this.sockets()
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean)
      .map((a) => ({
        ch: a.ch,
        playing: !!a.playing,
        platform: a.platform,
        country: a.country,
        isp: a.isp,
        minutes: Math.round((now - a.start) / 60000),
      }));
  }

  // Seconds of sessions still running, so today's numbers are live.
  liveWatch(now) {
    const out = {};
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playing && a.ch && a.since) out[a.ch] = (out[a.ch] || 0) + Math.max(0, Math.round((now - a.since) / 1000));
    }
    return out;
  }

  // Small and cheap: polled every few seconds by the dashboard.
  liveSnapshot(now, since) {
    const viewers = this.viewers(now);
    const today = dayOf(now);
    const counters = this.sql
      .exec(
        "SELECT day, key, n FROM daily WHERE day = ? AND (key IN ('sessions', 'visitors', 'peak_online', 'peak_watching') OR key BETWEEN 'watch:' AND 'watch:~')",
        today,
      )
      .toArray();
    const timeline = since
      ? this.sql.exec('SELECT ts, online, watching FROM timeline WHERE ts > ? ORDER BY ts LIMIT 500', since).toArray()
      : [];
    return {
      part: 'live',
      now,
      today,
      online: viewers.length,
      watching: viewers.filter((v) => v.playing).length,
      viewers,
      counters,
      liveWatch: this.liveWatch(now),
      timeline,
    };
  }

  // The 30-day history: polled every few minutes, memoized for a minute.
  fullSnapshot(now) {
    if (!this.fullCache || now - this.fullCache.at > FULL_CACHE_MS) {
      const since30 = dayOf(now - 29 * 86400e3);
      const counters = this.sql.exec('SELECT day, key, n FROM daily WHERE day >= ?', since30).toArray();
      const timeline = this.sql
        .exec('SELECT ts, online, watching FROM timeline WHERE ts >= ? ORDER BY ts', now - 24 * 3600e3)
        .toArray();
      const before = this.sql
        .exec('SELECT ts, online, watching FROM timeline WHERE ts < ? ORDER BY ts DESC LIMIT 1', now - 24 * 3600e3)
        .toArray();
      const events = this.sql
        .exec('SELECT ts, kind, channel, detail, status, host, country, isp, platform FROM events ORDER BY ts DESC LIMIT 60')
        .toArray();
      this.fullCache = { at: now, counters, timeline: before.concat(timeline), events };
    }
    const viewers = this.viewers(now);
    return {
      part: 'full',
      now,
      today: dayOf(now),
      online: viewers.length,
      watching: viewers.filter((v) => v.playing).length,
      viewers,
      counters: this.fullCache.counters,
      liveWatch: this.liveWatch(now),
      timeline: this.fullCache.timeline,
      events: this.fullCache.events,
    };
  }
}
