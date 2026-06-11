import { useState, useCallback, useEffect, useRef } from 'react'

interface WebKitHTMLVideoElement extends HTMLVideoElement {
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}

// The pip-staging viewport-cover trick is only needed (and only acceptable) on
// mobile: there the floating window hides the page, and Chrome on Android is
// where the small-source-rect white-margins bug lives. On desktop the page
// stays visible next to the PiP window, so covering it would be a regression.
const isMobileLike =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

export function usePiP(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isPiP, setIsPiP] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  // True while a PiP session was started by our button (vs. the native
  // fullscreen-swipe auto-PiP). Only then do we own the fullscreen state and
  // must unwind it when the session ends.
  const enteredFromButtonRef = useRef(false)

  useEffect(() => {
    const video = document.createElement('video') as unknown as WebKitHTMLVideoElement
    const supported =
      'pictureInPictureEnabled' in document ||
      typeof video.webkitSetPresentationMode === 'function'
    setIsSupported(supported)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onEnter = () => setIsPiP(true)
    const onLeave = () => {
      // End the manual-PiP staging (see togglePiP) however the session ended —
      // button toggle, window close, or return-to-app. Fullscreen is only
      // unwound when we entered it ourselves; a user-initiated fullscreen
      // (the auto-PiP swipe path) keeps its state.
      video.classList.remove('pip-staging')
      if (enteredFromButtonRef.current) {
        enteredFromButtonRef.current = false
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      }
      setIsPiP(false)
    }

    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [videoRef])

  const togglePiP = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if ('requestPictureInPicture' in video) {
        // Release the portrait orientation lock BEFORE entering PiP. The system
        // captures the floating window's source rect at the moment of entry — a
        // portrait lock active here leaves white margins when the user enlarges
        // the floating window. Auto-PiP via swipe doesn't hit this because the
        // app is already fullscreen (orientation 'any') when it triggers.
        // useOrientationLock will re-lock to portrait on `leavepictureinpicture`.
        const orientation = screen.orientation as ScreenOrientation & {
          unlock?: () => void
        }
        try { orientation.unlock?.() } catch { /* noop */ }
        // Manual-button PiP breaks on Android (video frozen at its small
        // inline size on a white surface when the floating window is enlarged)
        // while the native fullscreen-swipe auto-PiP works. The difference is
        // the state the surface is captured from, so reproduce the working
        // path exactly: enter fullscreen first — requestFullscreen requires
        // transient activation but does NOT consume it, so the PiP request
        // below still rides the same button click. The pip-staging class is
        // belt-and-braces for devices where requestFullscreen rejects.
        if (isMobileLike) {
          enteredFromButtonRef.current = true
          video.classList.add('pip-staging')
          const container = (video.closest('.player-container') ?? video) as HTMLElement
          try {
            await container.requestFullscreen?.()
          } catch { /* staging still covers the viewport */ }
        }
        // Two frames so the layout actually settles before PiP entry.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        try {
          await video.requestPictureInPicture()
        } catch (err) {
          // Entry failed — unwind the staging fullscreen/cover immediately.
          video.classList.remove('pip-staging')
          if (enteredFromButtonRef.current) {
            enteredFromButtonRef.current = false
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
          }
          throw err
        }
      } else {
        const webkitVideo = video as WebKitHTMLVideoElement
        if (webkitVideo.webkitSetPresentationMode) {
          const mode = webkitVideo.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'
          webkitVideo.webkitSetPresentationMode(mode)
          setIsPiP(mode === 'picture-in-picture')
        }
      }
    } catch (err) {
      console.warn('PiP failed:', err)
    }
  }, [videoRef])

  return { isPiP, isSupported, togglePiP }
}
