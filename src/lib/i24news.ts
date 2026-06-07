/**
 * i24 News Hebrew stream URL resolver
 *
 * Fetches the live stream URL by:
 * 1. Authenticating anonymously via the Wiztivi API
 * 2. Fetching the channel list and extracting the Hebrew m3u8 URL
 *
 * The m3u8 URL contains an hdnea token that expires after ~60 minutes.
 */

import { fetchWithTimeout } from './fetchUtils'

const AUTH_URL = 'https://api.i24news.wiztivi.io/authenticate'
const CONTENT_URL = 'https://api.i24news.wiztivi.io/contents'

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

    const url = hebrew.customFields.m3u8

    // Cache for 50 minutes (hdnea token expires at ~60min)
    cached = { url, expiresAt: Date.now() + 50 * 60_000 }
    return url
  } catch (err) {
    // Invalidate so a re-resolve doesn't loop on a stale token.
    cached = null
    throw err
  }
}
