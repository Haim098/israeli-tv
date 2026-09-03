import { useCallback, useEffect, useState } from 'react'
import { useTvStore } from '../stores/tvStore'

/**
 * Fullscreen for the player, with two implementations:
 *
 * - **immersive** (touch devices, the default there): the player is stretched
 *   over the whole viewport with CSS only — the Fullscreen API is deliberately
 *   *not* used. Chrome on Android paints its own "כדי לצאת ממסך מלא, צריך
 *   לגרור מלמעלה וללחוץ על הכפתור" bubble across the bottom of the screen for
 *   as long as that API is active. It is browser UI: a page can't restyle,
 *   move or dismiss it, and it sat right on top of our control bar. Staying
 *   out of browser fullscreen is the only way to be rid of it.
 * - **native** (pointer devices): the real Fullscreen API. On desktop it's the
 *   only way to drop the browser chrome, and the notice Chrome shows there is
 *   transient and doesn't cover the controls.
 *
 * Both modes report through the same `isFullscreen` flag; `isImmersive` also
 * lands in the store so `useOrientationLock` can relax the portrait lock the
 * same way it does for native fullscreen.
 */

/** Native fullscreen is only worth using where its exit-toast isn't in the way. */
function preferImmersive(): boolean {
  if (!document.fullscreenEnabled) return true
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

export function useFullscreen(targetRef: React.RefObject<HTMLElement | null>) {
  const isImmersive = useTvStore((s) => s.isImmersive)
  const setImmersive = useTvStore((s) => s.setImmersive)
  const [isNative, setIsNative] = useState(false)

  useEffect(() => {
    const sync = () => setIsNative(!!document.fullscreenElement)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // Lock page scrolling behind the expanded player.
  useEffect(() => {
    document.documentElement.classList.toggle('immersive-active', isImmersive)
    return () => document.documentElement.classList.remove('immersive-active')
  }, [isImmersive])

  const exitImmersive = useCallback(() => {
    setImmersive(false)
    // Drop the history entry pushed on entry, unless we got here *from* a back
    // navigation (the entry is already gone by then).
    try {
      if ((history.state as { tvImmersive?: boolean } | null)?.tvImmersive) history.back()
    } catch { /* history is best-effort */ }
  }, [setImmersive])

  const enterImmersive = useCallback(() => {
    setImmersive(true)
    // Give Android's back gesture something to pop, so it exits the expanded
    // player instead of leaving the app — matching native fullscreen.
    try {
      history.pushState({ tvImmersive: true }, '')
    } catch { /* history is best-effort */ }
  }, [setImmersive])

  useEffect(() => {
    if (!isImmersive) return
    const onPop = () => setImmersive(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitImmersive() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  }, [isImmersive, setImmersive, exitImmersive])

  const toggle = useCallback(() => {
    if (isImmersive) {
      exitImmersive()
      return
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
      return
    }
    if (preferImmersive()) {
      enterImmersive()
      return
    }
    const target = targetRef.current
    try {
      const req = target?.requestFullscreen?.({ navigationUI: 'hide' })
      // Fall back to the CSS expansion when the request is refused.
      if (req) req.catch(() => enterImmersive())
      else enterImmersive()
    } catch {
      enterImmersive()
    }
  }, [isImmersive, enterImmersive, exitImmersive, targetRef])

  return { isFullscreen: isImmersive || isNative, isImmersive, toggle }
}
