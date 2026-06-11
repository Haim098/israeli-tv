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
  // Surfaced in the UI so on-device PiP failures are diagnosable without a
  // remote console (NotAllowedError vs. InvalidStateError etc. point at very
  // different root causes). Auto-clears after a few seconds.
  const [pipError, setPipError] = useState<string | null>(null)

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
        // NOTE: keep this path free of awaits before requestPictureInPicture().
        // An earlier revision awaited requestFullscreen() here first (to mimic
        // the working fullscreen-swipe auto-PiP path) and Android rejected the
        // PiP request outright — the floating window stopped opening at all.
        // Release the portrait orientation lock so the floating window isn't
        // constrained; useOrientationLock re-locks on leavepictureinpicture.
        const orientation = screen.orientation as ScreenOrientation & {
          unlock?: () => void
        }
        try { orientation.unlock?.() } catch { /* noop */ }
        // Cover the viewport with the video for the duration of the session —
        // harmless (the page is hidden behind the floating window) and helps
        // devices where the PiP surface is captured from the element's rect.
        if (isMobileLike) video.classList.add('pip-staging')
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
      const e = err as Partial<Error> | undefined
      setPipError(`${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`)
      window.setTimeout(() => setPipError(null), 8000)
    }
  }, [videoRef])

  return { isPiP, isSupported, togglePiP, pipError }
}
