/** `?debug=1` turns the on-screen A/V timing overlay on (remembered), `?debug=0` off. */
const DEBUG_KEY = 'avDebug'

export function isAVDebugEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('debug')
    if (q === '1') localStorage.setItem(DEBUG_KEY, '1')
    if (q === '0') localStorage.removeItem(DEBUG_KEY)
    return localStorage.getItem(DEBUG_KEY) === '1'
  } catch {
    return false
  }
}
