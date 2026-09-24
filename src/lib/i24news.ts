/**
 * i24 News Hebrew stream URL resolver
 *
 * Tries two upstream sources, newest-first:
 * 1. The immergo CDN feed used by the official i24news.tv/he/tv-live page —
 *    tokenless, CORS-open, served via CloudFront. This is the same source the
 *    official site players use, so it is the most reliable.
 * 2. The Wiztivi API → Brightcove feed (legacy source). Its m3u8 URL carries
 *    an hdnea token that expires after ~60 minutes, and the feed itself
 *    sometimes freezes on a stale 30s VOD window.
 *
 * Each candidate is sanity-checked to be actually live (not a frozen VOD
 * window) before being returned.
 */

import { fetchWithTimeout } from './fetchUtils'
import { assertPlaylistIsLive } from './hlsLive'

// Source 1: official-site feed (no auth, no token).
const DIRECT_URL = 'https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8'

// Source 2: Wiztivi resolver endpoints.
const AUTH_URL = 'https://api.i24news.wiztivi.io/authenticate'
const CONTENT_URL = 'https://api.i24news.wiztivi.io/contents'

export interface I24StaleError extends Error {
  /** Hebrew message safe to surface in the UI error overlay. */
  userMessage: string
  /** Marks this error as the "upstream is broken" variant so callers can branch. */
  isStaleStream: true
}

function makeStaleError(reason: string): I24StaleError {
  const err = new Error(`i24 stream is not live: ${reason}`) as I24StaleError
  err.userMessage = 'שידור i24 אינו זמין כרגע — ה-upstream משדר חלון ישן ולא ניתן לנגן לייב. נסה שוב מאוחר יותר.'
  err.isStaleStream = true
  return err
}

let cached: { url: string; expiresAt: number } | null = null
let inFlight: Promise<string> | null = null

export async function getI24NewsUrl(force = false): Promise<string> {
  // Return cached if valid (with 60s buffer before expiry)
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.url
  // De-dupe concurrent resolutions.
  if (inFlight) return inFlight
  inFlight = resolveI24().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function resolveI24(): Promise<string> {
  // Source 1: direct immergo feed. Short cache — the URL is static and
  // tokenless, but we still want a frozen feed to be re-checked soon.
  try {
    await assertPlaylistIsLive(DIRECT_URL, makeStaleError)
    cached = { url: DIRECT_URL, expiresAt: Date.now() + 5 * 60_000 }
    return DIRECT_URL
  } catch {
    // Fall through to the Wiztivi source.
  }

  try {
    const url = await resolveViaWiztivi()
    await assertPlaylistIsLive(url, makeStaleError)
    // Cache for 50 minutes (hdnea token expires at ~60min)
    cached = { url, expiresAt: Date.now() + 50 * 60_000 }
    return url
  } catch (err) {
    // Invalidate so a re-resolve doesn't loop on a stale token or stale window.
    cached = null
    throw err
  }
}

async function resolveViaWiztivi(): Promise<string> {
  // Step 1: Anonymous auth (no account needed)
  const authResp = await fetchWithTimeout(
    `${AUTH_URL}?userName=I24News&hardwareId=${crypto.randomUUID()}&hardwareIdType=browser`
  )
  const { accessToken } = await authResp.json()
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('i24 auth did not return an access token')
  }

  // Step 2: Fetch channel list, extract Hebrew m3u8
  const contentResp = await fetchWithTimeout(
    `${CONTENT_URL}?provider=brightcove&type=DYNAMIC&key=channel&value=all`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const channels: Array<{ id?: string; customFields?: { m3u8?: string } }> = await contentResp.json()
  const hebrew = Array.isArray(channels) ? channels.find((c) => c.id === 'he') : undefined
  if (!hebrew?.customFields?.m3u8) throw new Error('Hebrew stream not found')

  return hebrew.customFields.m3u8
}
