/**
 * i24 News Hebrew stream URL resolver
 *
 * Fetches the live stream URL by:
 * 1. Authenticating anonymously via the Wiztivi API
 * 2. Fetching the channel list and extracting the Hebrew m3u8 URL
 *
 * The m3u8 URL contains an hdnea token that expires after ~60 minutes.
 */

const AUTH_URL = 'https://api.i24news.wiztivi.io/authenticate'
const CONTENT_URL = 'https://api.i24news.wiztivi.io/contents'

let cached: { url: string; expiresAt: number } | null = null

export async function getI24NewsUrl(): Promise<string> {
  // Return cached if valid (with 60s buffer before 50min cache expiry)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url

  // Step 1: Anonymous auth (no account needed)
  const authResp = await fetch(
    `${AUTH_URL}?userName=I24News&hardwareId=${Date.now()}&hardwareIdType=browser`
  )
  const { accessToken } = await authResp.json()

  // Step 2: Fetch channel list, extract Hebrew m3u8
  const contentResp = await fetch(
    `${CONTENT_URL}?provider=brightcove&type=DYNAMIC&key=channel&value=all`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const channels = await contentResp.json()
  const hebrew = channels.find((c: any) => c.id === 'he')
  if (!hebrew?.customFields?.m3u8) throw new Error('Hebrew stream not found')

  const url = hebrew.customFields.m3u8

  // Cache for 50 minutes (hdnea token expires at ~60min)
  cached = { url, expiresAt: Date.now() + 50 * 60_000 }
  return url
}
