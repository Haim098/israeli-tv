import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import Hls from 'hls.js'
import type { Channel } from '../../types'
import { useTvStore } from '../../stores/tvStore'

interface VideoPlayerProps {
  channel: Channel
  onFallbackToIframe?: (url: string) => void
}

export interface VideoPlayerHandle {
  getVideo: () => HTMLVideoElement | null
  play: () => void
  pause: () => void
  togglePlay: () => void
  isPlaying: () => boolean
  seekTo: (time: number) => void
  getCurrentTime: () => number
  getSeekableRange: () => { start: number; end: number } | null
  getLiveSyncPosition: () => number | null
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ channel, onFallbackToIframe }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const hlsRef = useRef<Hls | null>(null)
    const isSwappedRef = useRef(false)
    const setLoading = useTvStore((s) => s.setLoading)
    const setError = useTvStore((s) => s.setError)

    useImperativeHandle(ref, () => ({
      getVideo: () => videoRef.current,
      play: () => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        el?.play()
      },
      pause: () => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        el?.pause()
      },
      togglePlay: () => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        if (!el) return
        el.paused ? el.play() : el.pause()
      },
      isPlaying: () => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        return !el?.paused
      },
      seekTo: (time: number) => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        if (el) el.currentTime = time
      },
      getCurrentTime: () => {
        const el = isSwappedRef.current ? audioRef.current : videoRef.current
        return el?.currentTime ?? 0
      },
      getSeekableRange: () => {
        const video = videoRef.current
        if (!video || video.seekable.length === 0) return null
        return { start: video.seekable.start(0), end: video.seekable.end(0) }
      },
      getLiveSyncPosition: () => hlsRef.current?.liveSyncPosition ?? null,
    }))

    const loadStream = useCallback((url: string) => {
      const video = videoRef.current
      if (!video) return

      // Cleanup previous instance
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 300,
          liveDurationInfinity: true,
          liveSyncDurationCount: 2,
        })
        hlsRef.current = hls

        hls.loadSource(url)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false)
          video.play().catch(() => {})
        })

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // For dynamic-URL channels, re-resolve (token may have expired)
                if (channel.resolveUrl) {
                  console.warn('Network error on dynamic stream, re-resolving URL...')
                  hls.destroy()
                  channel.resolveUrl().then((freshUrl) => {
                    loadStream(freshUrl)
                  }).catch(() => {
                    if (channel.fallbackUrl) {
                      onFallbackToIframe?.(channel.fallbackUrl)
                    } else {
                      setError('שגיאה בטעינת השידור')
                    }
                  })
                  return
                }
                // Try fallback URL
                if (channel.fallbackUrl && url !== channel.fallbackUrl) {
                  console.warn('Primary URL failed, trying fallback...')
                  if (!channel.fallbackUrl.endsWith('.m3u8')) {
                    // Fallback is an iframe URL
                    hls.destroy()
                    onFallbackToIframe?.(channel.fallbackUrl)
                    return
                  }
                  loadStream(channel.fallbackUrl)
                  return
                }
                hls.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError()
                break
              default:
                setError('שגיאה בטעינת השידור')
                hls.destroy()
                break
            }
          }
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // iOS Safari — native HLS
        video.src = url
        video.addEventListener('loadedmetadata', () => {
          setLoading(false)
          video.play().catch(() => {})
        }, { once: true })

        video.addEventListener('error', () => {
          if (channel.fallbackUrl && url !== channel.fallbackUrl) {
            if (!channel.fallbackUrl.endsWith('.m3u8')) {
              onFallbackToIframe?.(channel.fallbackUrl)
              return
            }
            loadStream(channel.fallbackUrl)
          } else {
            setError('שגיאה בטעינת השידור')
          }
        }, { once: true })
      } else {
        setError('הדפדפן אינו תומך בהפעלת וידאו')
      }
    }, [channel.fallbackUrl, setLoading, setError, onFallbackToIframe])

    // Load stream on channel change — resolve dynamic URL if needed
    useEffect(() => {
      let cancelled = false
      setLoading(true)

      if (channel.resolveUrl) {
        channel.resolveUrl().then((url) => {
          if (!cancelled) loadStream(url)
        }).catch((err) => {
          if (!cancelled) {
            console.error('Failed to resolve stream URL:', err)
            // Fall back to iframe URL if available
            if (channel.fallbackUrl) {
              onFallbackToIframe?.(channel.fallbackUrl)
            } else {
              setError('שגיאה בטעינת השידור')
            }
          }
        })
      } else {
        loadStream(channel.streamUrl)
      }

      return () => {
        cancelled = true
        if (hlsRef.current) {
          hlsRef.current.destroy()
          hlsRef.current = null
        }
      }
    }, [channel.id, channel.streamUrl, channel.resolveUrl, channel.fallbackUrl, loadStream, setLoading, setError, onFallbackToIframe])

    // Background playback: auto-PiP first, fall back to audio swap
    useEffect(() => {
      const swapToAudio = () => {
        const hls = hlsRef.current
        const audio = audioRef.current
        if (!hls || !audio || isSwappedRef.current) return
        hls.detachMedia()
        hls.attachMedia(audio)
        audio.play().catch(() => {})
        isSwappedRef.current = true
      }

      const onVisibility = () => {
        const video = videoRef.current
        const audio = audioRef.current
        const hls = hlsRef.current

        if (document.visibilityState === 'hidden' && video) {
          // Try auto Picture-in-Picture first (keeps video in floating window)
          if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
            video.requestPictureInPicture().catch(swapToAudio)
          } else {
            swapToAudio()
          }
        } else if (document.visibilityState === 'visible' && video) {
          // Exit PiP if active
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {})
          }

          if (isSwappedRef.current && hls && audio) {
            // Swap back from audio to video
            const wasPaused = audio.paused
            audio.pause()
            hls.detachMedia()
            hls.attachMedia(video)
            isSwappedRef.current = false
            video.addEventListener('canplay', () => {
              const pos = hls.liveSyncPosition
              if (pos != null) video.currentTime = pos
              if (!wasPaused) video.play().catch(() => {})
            }, { once: true })
          } else {
            // Not swapped (was in PiP or native HLS) — seek to live edge
            if (hls) {
              const pos = hls.liveSyncPosition
              if (pos != null) video.currentTime = pos
            } else if (video.duration === Infinity) {
              video.currentTime = video.seekable.length > 0
                ? video.seekable.end(video.seekable.length - 1)
                : video.duration
            }
            video.play().catch(() => {})
          }
        }
      }

      // If PiP closes while still in background, fall back to audio
      const onLeavePiP = () => {
        if (document.visibilityState === 'hidden') swapToAudio()
      }

      const video = videoRef.current
      document.addEventListener('visibilitychange', onVisibility)
      video?.addEventListener('leavepictureinpicture', onLeavePiP)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        video?.removeEventListener('leavepictureinpicture', onLeavePiP)
      }
    }, [])

    return (
      <>
        <video
          ref={videoRef}
          className="h-full w-full object-contain bg-black"
          playsInline
          // @ts-ignore non-standard attributes
          webkit-playsinline=""
          autoPlay
          muted={false}
          // @ts-ignore autopictureinpicture is not yet in TS types
          autopictureinpicture=""
        />
        <audio ref={audioRef} hidden />
      </>
    )
  },
)
