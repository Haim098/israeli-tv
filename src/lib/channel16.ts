/**
 * Channel 16 stream URL resolver
 *
 * The channel's live feed is on the same immergo CDN as i24's official-site
 * feed — tokenless and CORS-open, so the URL itself is static. What the
 * resolver adds is a liveness check: Channel 16 is off the air on Shabbat and
 * Israeli holidays, and instead of an endless spinner (or a frozen window on
 * loop) we surface a Hebrew message explaining that.
 */

import { assertPlaylistIsLive } from './hlsLive'

const STREAM_URL = 'https://ch16israel-cdn.encoders.immergo.tv/master.m3u8'

const OFF_AIR_MESSAGE = 'ערוץ 16 אינו משדר כרגע (הערוץ לא משדר בשבתות ובחגים). נסה שוב מאוחר יותר.'

function makeOffAirError(reason: string): Error & { userMessage: string } {
  const err = new Error(`Channel 16 stream is not live: ${reason}`) as Error & { userMessage: string }
  err.userMessage = OFF_AIR_MESSAGE
  return err
}

let cached: { url: string; expiresAt: number } | null = null
let inFlight: Promise<string> | null = null

export async function getChannel16Url(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.url
  // De-dupe concurrent resolutions.
  if (inFlight) return inFlight
  inFlight = resolveChannel16().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function resolveChannel16(): Promise<string> {
  try {
    await assertPlaylistIsLive(STREAM_URL, makeOffAirError)
  } catch (err) {
    cached = null
    // A 404/timeout from the CDN also means "nothing on air" from the
    // viewer's point of view — give it the same friendly message.
    throw err && typeof err === 'object' && 'userMessage' in err
      ? err
      : makeOffAirError(err instanceof Error ? err.message : String(err))
  }
  // Short cache — the URL is static, but an ended broadcast should be
  // re-checked soon.
  cached = { url: STREAM_URL, expiresAt: Date.now() + 5 * 60_000 }
  return STREAM_URL
}
