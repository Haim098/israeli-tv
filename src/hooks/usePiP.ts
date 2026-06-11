import { useState, useCallback, useEffect } from 'react'

interface WebKitHTMLVideoElement extends HTMLVideoElement {
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}

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
    const onLeave = () => setIsPiP(false)

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
        // Two frames so the viewport actually settles before PiP entry.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        await video.requestPictureInPicture()
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
