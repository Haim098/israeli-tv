import { useEffect } from 'react'

/**
 * Actively locks the app to portrait at runtime — more reliable than the
 * manifest `orientation` field, which an already-installed PWA only picks up
 * lazily (and inconsistently) on Android. While a video is fullscreen the lock
 * is relaxed to `any` so the user can rotate freely; on exit it re-locks
 * portrait. No-ops where the Orientation Lock API isn't available (desktop, or
 * a plain browser tab where lock() is rejected outside fullscreen).
 */
export function useOrientationLock() {
  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'portrait' | 'any') => Promise<void>
    }
    if (!orientation || typeof orientation.lock !== 'function') return

    const apply = () => {
      const target = document.fullscreenElement ? 'any' : 'portrait'
      orientation.lock!(target).catch(() => {})
    }

    apply()
    document.addEventListener('fullscreenchange', apply)
    return () => document.removeEventListener('fullscreenchange', apply)
  }, [])
}
