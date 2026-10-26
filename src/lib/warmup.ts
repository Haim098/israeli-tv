/**
 * Channel warm-up: start the slow, invisible part of loading a channel before
 * the user actually switches to it.
 *
 * For token/liveness channels (Keshet 12, i24, Channel 16) that's the resolver:
 * two or three sequential API/playlist requests that otherwise run *before*
 * hls.js can even fetch the manifest. Resolvers cache their result and de-dupe
 * in-flight calls, so a warm-up followed by a real switch costs nothing extra.
 * For plain HLS channels we open the TLS connection to the stream host early.
 */

import type { Channel } from '../types'

// Browsers drop an unused preconnected socket after ~10s, so a channel pressed
// again later needs a fresh hint rather than a "seen it already" skip.
const PRECONNECT_TTL_MS = 10_000
const preconnected = new Map<string, { link: HTMLLinkElement; at: number }>()

function preconnect(url: string): void {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return
  }
  const now = Date.now()
  const prev = preconnected.get(origin)
  if (prev && now - prev.at < PRECONNECT_TTL_MS) return
  prev?.link.remove()
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = origin
  // hls.js loads playlists/segments with CORS requests, so the warmed
  // connection must be the anonymous-CORS one or the browser won't reuse it.
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
  preconnected.set(origin, { link, at: now })
}

export function warmChannel(channel: Channel): void {
  if (channel.type !== 'hls') return
  if (channel.resolveUrl) {
    // Failures are fine here: the resolver drops its cache on error, and the
    // real load will retry and surface the error then.
    channel.resolveUrl().catch(() => {})
  } else {
    preconnect(channel.streamUrl)
  }
}

const IDLE_WARM_FALLBACK_MS = 8_000
const IDLE_WARM_DELAY_MS = 2_000

/**
 * Once the current channel is up (or after a fallback delay if it never
 * starts), resolve the other token/liveness channels in the background so
 * switching to them skips the resolver round-trips. Waiting first keeps these
 * requests from competing with the current channel's first segments.
 */
export function scheduleIdleWarmup(
  channels: Channel[],
  subscribeToPlaying: (onPlaying: () => void) => () => void,
): () => void {
  let done = false
  let unsubscribe = () => {}
  let delayTimer: ReturnType<typeof setTimeout> | undefined
  let idleHandle: number | undefined

  const run = () => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(fallbackTimer)
    delayTimer = setTimeout(() => {
      const warmAll = () => channels.forEach((c) => { if (c.resolveUrl) warmChannel(c) })
      if ('requestIdleCallback' in window) {
        idleHandle = window.requestIdleCallback(warmAll, { timeout: 5_000 })
      } else {
        warmAll()
      }
    }, IDLE_WARM_DELAY_MS)
  }

  const fallbackTimer = setTimeout(run, IDLE_WARM_FALLBACK_MS)
  unsubscribe = subscribeToPlaying(run)
  // `run` may have fired synchronously during subscribe (already playing).
  if (done) unsubscribe()

  return () => {
    done = true
    unsubscribe()
    clearTimeout(fallbackTimer)
    clearTimeout(delayTimer)
    if (idleHandle !== undefined && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleHandle)
    }
  }
}
