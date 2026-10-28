/**
 * Live viewer count + usage history for the Israeli TV app.
 *
 * One Durable Object ("global") holds:
 * - a WebSocket per open copy of the app (hibernating, so idle sockets cost
 *   nothing). Its attachment says which channel it's on and whether it plays.
 * - SQLite tables with daily counters, unique visitors, the online-count
 *   timeline and recent playback problems.
 *
 * Nothing personal is stored: a random per-browser id (to count unique
 * visitors), country, network name and platform. No IP addresses.
 */
const TZ = 'Asia/Jerusalem';
const KEEP_DAYS = 45;
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
    this.lastOnline = null;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS counters (day TEXT, key TEXT, n INTEGER NOT NULL, PRIMARY KEY (day, key));
        CREATE TABLE IF NOT EXISTS visitors (day TEXT, vid TEXT, PRIMARY KEY (day, vid));
        CREATE TABLE IF NOT EXISTS online_log (ts INTEGER, online INTEGER, watching INTEGER);
        CREATE INDEX IF NOT EXISTS online_log_ts ON online_log (ts);
        CREATE TABLE IF NOT EXISTS events (ts INTEGER, kind TEXT, channel TEXT, detail TEXT, status INTEGER,
          host TEXT, country TEXT, isp TEXT, platform TEXT);
        CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      `);
    });
    // Keep-alive pings from the app are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  add(day, key, n = 1) {
    this.sql.exec(
      'INSERT INTO counters (day, key, n) VALUES (?, ?, ?) ON CONFLICT (day, key) DO UPDATE SET n = n + excluded.n',
      day, key, n,
    );
  }

  max(day, key, n) {
    this.sql.exec(
      'INSERT INTO counters (day, key, n) VALUES (?, ?, ?) ON CONFLICT (day, key) DO UPDATE SET n = max(n, excluded.n)',
      day, key, n,
    );
  }

  // Seconds watched since the attachment's last change go to that channel.
  flushWatch(att, now) {
    if (att.playing && att.ch && att.since) {
      const secs = Math.round((now - att.since) / 1000);
      if (secs > 0 && secs < 24 * 3600) {
        const day = dayOf(now);
        this.add(day, 'watch', secs);
        this.add(day, 'watch:' + att.ch, secs);
      }
    }
    att.since = now;
  }

  sockets(exclude) {
    return this.ctx.getWebSockets().filter((ws) => ws !== exclude && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING);
  }

  recordOnline(now, exclude) {
    const live = this.sockets(exclude);
    const online = live.length;
    let watching = 0;
    for (const ws of live) {
      const a = ws.deserializeAttachment();
      if (a && a.playing) watching++;
    }
    const key = online + '/' + watching;
    if (key !== this.lastOnline) {
      this.lastOnline = key;
      this.sql.exec('INSERT INTO online_log (ts, online, watching) VALUES (?, ?, ?)', now, online, watching);
      const day = dayOf(now);
      this.max(day, 'peak_online', online);
      this.max(day, 'peak_watching', watching);
    }
    if (Math.random() < 0.02) this.prune(now);
  }

  prune(now) {
    const cutoff = now - KEEP_DAYS * 86400e3;
    const cutDay = dayOf(cutoff);
    this.sql.exec('DELETE FROM online_log WHERE ts < ?', cutoff);
    this.sql.exec('DELETE FROM events WHERE ts < ?', cutoff);
    this.sql.exec('DELETE FROM visitors WHERE day < ?', cutDay);
    this.sql.exec('DELETE FROM counters WHERE day < ?', cutDay);
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

      const day = dayOf(now);
      this.add(day, 'sessions');
      if (att.vid) {
        const cur = this.sql.exec('INSERT OR IGNORE INTO visitors (day, vid) VALUES (?, ?)', day, att.vid);
        cur.toArray();
        if (cur.rowsWritten > 0) {
          this.add(day, 'visitors');
          this.add(day, 'country:' + att.country);
          this.add(day, 'platform:' + att.platform);
        }
      }
      this.recordOnline(now);
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
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/data') {
      return Response.json(this.snapshot(now), { headers: { 'Cache-Control': 'no-store' } });
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
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};
    this.flushWatch(att, now);
    if (typeof m.ch === 'string') att.ch = clip(m.ch, 24);
    if (typeof m.pl === 'boolean') att.playing = m.pl;
    ws.serializeAttachment(att);
    this.recordOnline(now);
  }

  closed(ws) {
    const now = Date.now();
    const att = ws.deserializeAttachment();
    if (att) {
      this.flushWatch(att, now);
      const secs = Math.round((now - (att.start || now)) / 1000);
      if (secs > 0 && secs < 24 * 3600) this.add(dayOf(now), 'session_secs', secs);
      ws.serializeAttachment(null);
    }
    this.recordOnline(now, ws);
  }

  async webSocketClose(ws, code) {
    this.closed(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // already closed
    }
  }

  async webSocketError(ws) {
    this.closed(ws);
  }

  snapshot(now) {
    const live = this.sockets();
    const viewers = live
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

    const since30 = dayOf(now - 29 * 86400e3);
    const counters = this.sql.exec('SELECT day, key, n FROM counters WHERE day >= ? ORDER BY day', since30).toArray();

    // Add the minutes of sessions still running, so today's numbers are live.
    const today = dayOf(now);
    const liveWatch = {};
    for (const ws of live) {
      const a = ws.deserializeAttachment();
      if (a && a.playing && a.ch && a.since) {
        const s = Math.max(0, Math.round((now - a.since) / 1000));
        liveWatch[a.ch] = (liveWatch[a.ch] || 0) + s;
      }
    }

    const timeline = this.sql
      .exec('SELECT ts, online, watching FROM online_log WHERE ts >= ? ORDER BY ts', now - 24 * 3600e3)
      .toArray();
    const before = this.sql
      .exec('SELECT ts, online, watching FROM online_log WHERE ts < ? ORDER BY ts DESC LIMIT 1', now - 24 * 3600e3)
      .toArray();

    const events = this.sql
      .exec('SELECT ts, kind, channel, detail, status, host, country, isp, platform FROM events ORDER BY ts DESC LIMIT 60')
      .toArray();

    return {
      now,
      today,
      online: viewers.length,
      watching: viewers.filter((v) => v.playing).length,
      viewers,
      counters,
      liveWatch,
      timeline: before.concat(timeline),
      events,
    };
  }
}
