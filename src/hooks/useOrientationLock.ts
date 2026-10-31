import { useEffect } from 'react'

// Tablets (and unfolded foldables) may rotate freely: watching sideways is
// what they're for. Android counts 600dp on the shortest side as a tablet.
const TABLET_MIN_SIDE = 600

export function isTablet(): boolean {
  return Math.min(screen.width, screen.height) >= TABLET_MIN_SIDE
}

type LockType = 'portrait' | 'landscape' | 'any'
type LockableOrientation = ScreenOrientation & { lock?: (orientation: LockType) => Promise<void> }

/** Recent lock attempts and their outcome, for the orientation debug panel. */
export const orientationLog: string[] = []

function log(line: string): void {
  orientationLog.push(`${new Date().toLocaleTimeString('he-IL')} ${line}`)
  if (orientationLog.length > 12) orientationLog.shift()
}

/** Ask the browser for an orientation; resolves to what happened. */
export function requestOrientation(type: LockType): Promise<void> {
  const orientation = screen.orientation as LockableOrientation | undefined
  if (!orientation || typeof orientation.lock !== 'function') {
    log(`lock(${type}) → API not available`)
    return Promise.resolve()
  }
  return orientation.lock(type).then(
    () => log(`lock(${type}) → ok`),
    (err: unknown) => log(`lock(${type}) → ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`),
  )
}

/**
 * On phones, actively locks the app to portrait at runtime — the manifest
 * allows any orientation so tablets can rotate. While a video is fullscreen
 * the lock is relaxed to `any` so the user can rotate freely; on exit it
 * re-locks portrait. No-ops where the Orientation Lock API isn't available
 * (desktop, or a plain browser tab where lock() is rejected outside
 * fullscreen).
 */
export function useOrientationLock() {
  useEffect(() => {
    const apply = () => {
      // Relax the lock while fullscreen OR in a PiP window. A portrait lock
      // active during manual PiP constrains the resizable floating window
      // (white margins / can't enlarge); auto-PiP didn't hit this because it
      // enters from the already-relaxed fullscreen state.
      const relaxed = isTablet() || !!document.fullscreenElement || !!document.pictureInPictureElement
      void requestOrientation(relaxed ? 'any' : 'portrait')
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
  }, [])
}
