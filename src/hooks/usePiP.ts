import { useState, useCallback, useEffect } from 'react'

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
      // End the manual-PiP staging cover (see togglePiP) however the session
      // ended — button toggle, window close, or return-to-app.
      video.classList.remove('pip-staging')
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
        // Cover the viewport with the video before entry — Chrome on Android
        // sizes the PiP surface from the element's on-screen rect, and entering
        // from the small inline player breaks enlarging the floating window
        // (white margins). This mirrors the fullscreen-swipe path, which works.
        // The class stays on for the whole PiP session (the page is hidden
        // behind the floating window) and onLeave removes it.
        if (isMobileLike) video.classList.add('pip-staging')
        // Two frames so the layout actually settles before PiP entry.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        try {
          await video.requestPictureInPicture()
        } catch (err) {
          video.classList.remove('pip-staging')
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
