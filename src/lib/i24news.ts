/**
 * i24 News Hebrew stream URL resolver
 *
 * Fetches the live stream URL by:
 * 1. Authenticating anonymously via the Wiztivi API
 * 2. Fetching the channel list and extracting the Hebrew m3u8 URL
 * 3. Sanity-checking that the playlist is actually live (not a frozen VOD window)
 *
 * The m3u8 URL contains an hdnea token that expires after ~60 minutes.
 */

import { fetchWithTimeout } from './fetchUtils'

const AUTH_URL = 'https://api.i24news.wiztivi.io/authenticate'
const CONTENT_URL = 'https://api.i24news.wiztivi.io/contents'

// Treat the playlist as stale if its most recent segment is older than this.
// Live HLS windows are normally <30s; >2min is upstream-frozen, not lag.
const MAX_LIVE_LAG_MS = 120_000

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
  // Return cached if valid (with 60s buffer before 50min cache expiry)
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.url
  // De-dupe concurrent resolutions.
  if (inFlight) return inFlight
  inFlight = resolveI24().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function resolveI24(): Promise<string> {
  try {
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
    const channels = await contentResp.json()
    const hebrew = Array.isArray(channels) ? channels.find((c: any) => c.id === 'he') : undefined
    if (!hebrew?.customFields?.m3u8) throw new Error('Hebrew stream not found')

    const url: string = hebrew.customFields.m3u8

    // Step 3: Sanity-check the playlist. The Wiztivi feed sometimes serves a
    // frozen VOD window (ENDLIST tag + 24h-old PROGRAM-DATE-TIME) which hls.js
    // would loop as a 30-second VOD clip — the user sees yesterday's news and
    // the "go live" button just seeks to the end of that stale window.
    await assertPlaylistIsLive(url)

    // Cache for 50 minutes (hdnea token expires at ~60min)
    cached = { url, expiresAt: Date.now() + 50 * 60_000 }
    return url
  } catch (err) {
    // Invalidate so a re-resolve doesn't loop on a stale token or stale window.
    cached = null
    throw err
  }
}

async function assertPlaylistIsLive(masterUrl: string): Promise<void> {
  // Fetch the master playlist, pick the first variant chunklist, and inspect
  // its tags. We bail with a friendly error rather than playing stale content.
  const masterResp = await fetchWithTimeout(masterUrl)
  const masterText = await masterResp.text()

  // The Brightcove master lists chunklists as bare filenames relative to the
  // master URL's directory (e.g. `chunklist__2.m3u8`). Resolve via URL().
  const variant = masterText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
  if (!variant) throw makeStaleError('no variant in master playlist')

  const variantUrl = new URL(variant, masterUrl).toString()
  const chunkResp = await fetchWithTimeout(variantUrl)
  const chunkText = await chunkResp.text()

  // ENDLIST means the upstream has marked this playlist as VOD — for a live
  // channel that's a broken state.
  if (chunkText.includes('#EXT-X-ENDLIST')) {
    throw makeStaleError('playlist has #EXT-X-ENDLIST (VOD)')
  }

  // PROGRAM-DATE-TIME tells us how recent the last segment really is. If the
  // newest one is hours/days old, the upstream is frozen.
  const pdtMatches = chunkText.match(/#EXT-X-PROGRAM-DATE-TIME:([^\s]+)/g)
  if (pdtMatches?.length) {
    const lastPdt = pdtMatches[pdtMatches.length - 1].replace('#EXT-X-PROGRAM-DATE-TIME:', '')
    const lastTime = Date.parse(lastPdt)
    if (Number.isFinite(lastTime)) {
      const lagMs = Date.now() - lastTime
      if (lagMs > MAX_LIVE_LAG_MS) {
        throw makeStaleError(`segment lag ${Math.round(lagMs / 1000)}s exceeds ${MAX_LIVE_LAG_MS / 1000}s`)
      }
    }
  }
}
