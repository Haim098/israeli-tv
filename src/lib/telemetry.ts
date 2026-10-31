/**
 * Minimal playback-problem reporting.
 *
 * Sends small JSON events (stream errors, reconnects, fallbacks to the
 * channel's website, long stalls) to the Cloudflare Worker's /api/log
 * endpoint, which writes them to Cloudflare Workers Logs. Nothing to run
 * or maintain: no database, logs expire on their own after a few days.
 *
 * No personal data: no IP (the worker adds only country / network name), no
 * identifiers beyond a random per-session id used to group one viewer's
 * events.
 */

// Set once the worker is deployed (wrangler prints its *.workers.dev URL).
// Empty = reporting disabled.
const TELEMETRY_URL: string =
  (import.meta.env.VITE_TELEMETRY_URL as string | undefined) ??
  'https://israeli-tv-proxy.haimtv.workers.dev/api/log'

export type TelemetryKind =
  | 'error' // a fatal stream error (we will reconnect)
  | 'recovered' // playback came back after reconnecting
  | 'fallback' // gave up on the direct stream, showing the channel's website
  | 'gave_up' // gave up, showing an error message
  | 'returned' // came back from the website to the direct stream
  | 'stall' // playback froze waiting for data for a while
  | 'media' // the decoder choked on the stream (hls.js media error)
  | 'crash' // a bug in our own code (uncaught exception / render crash)
  | 'start' // how long a channel took to start playing (every start)

export interface TelemetryEvent {
  kind: TelemetryKind
  channel: string
  /** hls.js error details or our own reason, e.g. "manifestLoadError". */
  detail?: string
  /** Why it failed, in words, e.g. "HTTP 403 from www.mako.co.il". */
  reason?: string
  /** HTTP status from the channel's server, when there was one. */
  status?: number
  /** Host that failed, e.g. "r.il.cdn-redge.media". */
  host?: string
  attempt?: number
  /** Duration in ms (stall length, time to recover, time to start…). */
  ms?: number
  /** The app was in the background (screen off / other app / audio-only). */
  bg?: boolean
  /** Bitrate of the quality being played, kbps. */
  kbps?: number
  /** Measured download speed, kbps. */
  bw?: number
  /** How long the last video segment took to download, ms. */
  frag?: number
  /** Seconds of video buffered ahead when it happened. */
  buf?: number
}

// Budgets per page load, so one bad session can't flood the logs.
const BUDGET: Partial<Record<TelemetryKind, number>> = { crash: 10, start: 40 }
const MAX_PROBLEMS_PER_SESSION = 60
const DEDUPE_WINDOW_MS = 10_000

const sessionId = Math.random().toString(36).slice(2, 10)
const used = new Map<string, number>()
const recent = new Map<string, number>()

function connectionType(): string | undefined {
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection
  return c ? [c.type, c.effectiveType].filter(Boolean).join('/') || undefined : undefined
}

function platform(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'desktop'
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/**
 * A short, safe description of an error: its message with any URLs cut down
 * to their host (stream URLs carry access tokens).
 */
export function reasonOf(err: unknown, max = 160): string | undefined {
  let msg: string
  if (err instanceof Error) msg = err.name && err.name !== 'Error' ? `${err.name}: ${err.message}` : err.message
  else if (typeof err === 'string') msg = err
  else return undefined
  msg = msg.replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, '$1').replace(/\s+/g, ' ').trim()
  return msg ? msg.slice(0, max) : undefined
}

/** HTTP status mentioned in an error message ("HTTP 403 from …"). */
export function statusOf(err: unknown): number | undefined {
  const m = err instanceof Error ? /HTTP (\d{3})/.exec(err.message) : null
  return m ? Number(m[1]) : undefined
}

export function report(event: TelemetryEvent): void {
  if (!TELEMETRY_URL) return
  const bucket = BUDGET[event.kind] ? event.kind : 'problems'
  const limit = BUDGET[event.kind] ?? MAX_PROBLEMS_PER_SESSION
  if ((used.get(bucket) ?? 0) >= limit) return
  // Drop repeats of the same thing within a few seconds.
  if (event.kind !== 'start') {
    const key = `${event.kind}|${event.channel}|${event.detail}|${event.attempt}|${event.reason}`
    const now = Date.now()
    const last = recent.get(key)
    if (last && now - last < DEDUPE_WINDOW_MS) return
    recent.set(key, now)
  }
  used.set(bucket, (used.get(bucket) ?? 0) + 1)

  const body = JSON.stringify({
    ...event,
    session: sessionId,
    build: __BUILD_ID__,
    platform: platform(),
    net: connectionType(),
    online: navigator.onLine,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || undefined,
  })
  try {
    // text/plain keeps it a "simple" request: no CORS preflight, and
    // sendBeacon still delivers it if the page is closing.
    const blob = new Blob([body], { type: 'text/plain' })
    if (!navigator.sendBeacon?.(TELEMETRY_URL, blob)) {
      fetch(TELEMETRY_URL, { method: 'POST', body, keepalive: true, mode: 'no-cors' }).catch(() => {})
    }
  } catch {
    // Reporting must never affect playback.
  }
}

/** The first couple of stack frames, as "function@file:line:col". */
function whereOf(err: unknown): string | undefined {
  const stack = err instanceof Error ? err.stack : undefined
  if (!stack) return undefined
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /:\d+:\d+\)?$/.test(l))
    .slice(0, 2)
    .map((l) => l.replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/[()]/g, ''))
  return frames.length ? frames.join(' < ').slice(0, 160) : undefined
}

/** Report a bug in our own code. `where` says which part caught it. */
export function reportCrash(err: unknown, channel: string, where: string): void {
  const message = reasonOf(err, 80)
  // Cross-origin script errors carry no information at all.
  if (!message || message === 'Script error.') return
  report({ kind: 'crash', channel, detail: message, reason: [where, whereOf(err)].filter(Boolean).join(' | '), bg: document.visibilityState === 'hidden' || undefined })
}

/** Catch uncaught exceptions and unhandled promise rejections. */
export function installCrashReporting(currentChannel: () => string): void {
  window.addEventListener('error', (e) => {
    // Failed <img>/<script> loads also fire 'error' (without an Error object).
    if (!(e instanceof ErrorEvent)) return
    reportCrash(e.error ?? e.message, currentChannel(), 'window.onerror')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    // A play() interrupted by a channel switch is expected, not a bug.
    if (r instanceof DOMException && (r.name === 'AbortError' || r.name === 'NotAllowedError')) return
    reportCrash(r, currentChannel(), 'unhandledrejection')
  })
}
