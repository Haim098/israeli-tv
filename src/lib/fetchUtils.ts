/**
 * fetch with an AbortController timeout and a non-2xx guard.
 *
 * Stream resolvers call external APIs (mako, i24) that can hang on a stalled
 * network or return error pages. Without a timeout the player spinner would
 * stay forever; without an ok-check a 403/HTML body would be fed to the
 * decryptor/JSON parser and throw a cryptic error.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${new URL(url).host}`)
    }
    return resp
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).host} timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
