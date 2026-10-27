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
  ''

export type TelemetryKind =
  | 'error' // a fatal stream error (we will reconnect)
  | 'recovered' // playback came back after reconnecting
  | 'fallback' // gave up on the direct stream, showing the channel's website
  | 'gave_up' // gave up, showing an error message
  | 'returned' // came back from the website to the direct stream
  | 'stall' // playback froze waiting for data for a while

export interface TelemetryEvent {
  kind: TelemetryKind
  channel: string
  /** hls.js error details or our own reason, e.g. "manifestLoadError". */
  detail?: string
  /** HTTP status from the channel's server, when there was one. */
  status?: number
  /** Host that failed, e.g. "r.il.cdn-redge.media". */
  host?: string
  attempt?: number
  /** Duration in ms (stall length, time to recover…). */
  ms?: number
}

const MAX_EVENTS_PER_SESSION = 40
const DEDUPE_WINDOW_MS = 10_000

const sessionId = Math.random().toString(36).slice(2, 10)
let sent = 0
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

export function report(event: TelemetryEvent): void {
  if (!TELEMETRY_URL || sent >= MAX_EVENTS_PER_SESSION) return
  // Drop repeats of the same thing within a few seconds.
  const key = `${event.kind}|${event.channel}|${event.detail}|${event.attempt}`
  const now = Date.now()
  const last = recent.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return
  recent.set(key, now)
  sent += 1

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
