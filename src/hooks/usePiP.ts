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
