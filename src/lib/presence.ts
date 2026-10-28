/**
 * Live "who's watching now" for the usage dashboard.
 *
 * Keeps one WebSocket open to the Cloudflare Worker while the app is open and
 * tells it the current channel and whether it's playing. The worker counts
 * open sockets, so the dashboard can show viewers in real time.
 *
 * No personal data: a random per-browser id (to count unique visitors per
 * day), the channel id and the platform. Reporting must never affect playback.
 */
import { useTvStore } from '../stores/tvStore'

// Empty = presence disabled.
const PRESENCE_URL: string =
  (import.meta.env.VITE_PRESENCE_URL as string | undefined) ??
  'wss://israeli-tv-proxy.haimtv.workers.dev/api/live'

const PING_MS = 45_000
const MAX_BACKOFF_MS = 60_000

function visitorId(): string {
  const key = 'vid'
  try {
    let id = localStorage.getItem(key)
    if (!id) {
      id = Math.random().toString(36).slice(2, 12)
      localStorage.setItem(key, id)
    }
    return id
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

function platform(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'desktop'
}

export function startPresence(): void {
  if (!PRESENCE_URL || import.meta.env.DEV || typeof WebSocket === 'undefined') return

  const vid = visitorId()
  let ws: WebSocket | null = null
  let backoff = 2_000
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined

  const state = () => {
    const s = useTvStore.getState()
    return { ch: s.currentChannel.id, pl: s.isPlaying }
  }

  const send = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(state()))
      } catch {
        // ignore
      }
    }
  }

  const connect = () => {
    clearTimeout(retryTimer)
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    const { ch, pl } = state()
    const q = new URLSearchParams({ vid, p: platform(), ch, pl: pl ? '1' : '0' })
    try {
      ws = new WebSocket(`${PRESENCE_URL}?${q}`)
    } catch {
      scheduleRetry()
      return
    }
    ws.onopen = () => {
      backoff = 2_000
      send() // in case the state changed while connecting
      clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
      }, PING_MS)
    }
    ws.onclose = () => {
      clearInterval(pingTimer)
      ws = null
      scheduleRetry()
    }
    ws.onerror = () => {
      // onclose follows
    }
  }

  const scheduleRetry = () => {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }

  // Report channel switches and play/pause.
  useTvStore.subscribe((s, prev) => {
    if (s.currentChannel.id !== prev.currentChannel.id || s.isPlaying !== prev.isPlaying) send()
  })

  // Mobile browsers drop sockets in the background; reconnect right away
  // when the app comes back, and when the network returns.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      backoff = 2_000
      connect()
    }
  })
  window.addEventListener('online', () => {
    backoff = 2_000
    connect()
  })

  connect()
}
