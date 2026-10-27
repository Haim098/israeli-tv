/**
 * Sanity-check that an HLS master playlist is actually live, not a frozen
 * VOD window. Shared by resolvers of tokenless feeds (i24, Channel 16) that
 * would rather surface a friendly error than play stale content on loop.
 */

import { fetchWithTimeout } from './fetchUtils'

// Treat the playlist as stale if its most recent segment is older than this.
// Live HLS windows are normally <30s; >2min is upstream-frozen, not lag.
const MAX_LIVE_LAG_MS = 120_000

export async function assertPlaylistIsLive(
  masterUrl: string,
  makeStaleError: (reason: string) => Error,
): Promise<void> {
  // Fetch the master playlist, pick the first variant chunklist, and inspect
  // its tags. We bail with a friendly error rather than playing stale content.
  const masterResp = await fetchWithTimeout(masterUrl)
  const masterText = await masterResp.text()

  // Masters list chunklists relative to the master URL's directory (e.g.
  // `chunklist__2.m3u8` or `0/streamPlaylist.m3u8`). Resolve via URL().
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

/**
 * Cheap health check of a stream: the master playlist and its first variant
 * both load and the variant lists segments. Used to decide when to leave the
 * channel's website fallback and go back to the direct stream.
 */
export async function probeStream(masterUrl: string): Promise<boolean> {
  try {
    const masterText = await (await fetchWithTimeout(masterUrl, {}, 8_000)).text()
    const variant = masterText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'))
    if (!variant) return masterText.includes('#EXTINF')
    const variantUrl = new URL(variant, masterUrl).toString()
    const chunkText = await (await fetchWithTimeout(variantUrl, {}, 8_000)).text()
    return chunkText.includes('#EXTINF')
  } catch {
    return false
  }
}
