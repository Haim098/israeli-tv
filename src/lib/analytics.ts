/**
 * Visitor counts via Cloudflare Web Analytics: free, cookie-free, nothing to
 * host. Stats show up in the Cloudflare dashboard → Analytics & Logs → Web
 * Analytics.
 */

// The site token from Cloudflare (Web Analytics → Add a site → the
// `"token"` value in the snippet). It is public by design. Empty = off.
const CF_BEACON_TOKEN: string =
  (import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined) ??
  ''

export function startAnalytics(): void {
  if (!CF_BEACON_TOKEN || import.meta.env.DEV) return
  const script = document.createElement('script')
  script.defer = true
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }))
  document.head.appendChild(script)
}
