import { useEffect } from 'react'
import { useTvStore } from '../stores/tvStore'

/**
 * Actively locks the app to portrait at runtime — more reliable than the
 * manifest `orientation` field, which an already-installed PWA only picks up
 * lazily (and inconsistently) on Android. While a video is fullscreen the lock
 * is relaxed to `any` so the user can rotate freely; on exit it re-locks
 * portrait. No-ops where the Orientation Lock API isn't available (desktop, or
 * a plain browser tab where lock() is rejected outside fullscreen).
 */
export function useOrientationLock() {
  // CSS-based fullscreen (useFullscreen) has no `fullscreenchange` event of its
  // own, so the lock has to react to the store flag as well.
  const isImmersive = useTvStore((s) => s.isImmersive)

  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'portrait' | 'any') => Promise<void>
    }
    if (!orientation || typeof orientation.lock !== 'function') return

    const apply = () => {
      // Relax the lock while fullscreen OR in a PiP window. A portrait lock
      // active during manual PiP constrains the resizable floating window
      // (white margins / can't enlarge); auto-PiP didn't hit this because it
      // enters from the already-relaxed fullscreen state.
      const relaxed =
        isImmersive || !!document.fullscreenElement || !!document.pictureInPictureElement
      orientation.lock!(relaxed ? 'any' : 'portrait').catch(() => {})
    }

    apply()
    document.addEventListener('fullscreenchange', apply)
    // PiP events fire on the <video> and don't bubble — capture-phase listeners
    // on document still receive them as the event captures down to the target.
    document.addEventListener('enterpictureinpicture', apply, true)
    document.addEventListener('leavepictureinpicture', apply, true)
    return () => {
      document.removeEventListener('fullscreenchange', apply)
      document.removeEventListener('enterpictureinpicture', apply, true)
      document.removeEventListener('leavepictureinpicture', apply, true)
    }
  }, [isImmersive])
}
