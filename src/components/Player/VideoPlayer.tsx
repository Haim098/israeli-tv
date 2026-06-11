import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import Hls from 'hls.js'
import type { Channel } from '../../types'
import { useTvStore } from '../../stores/tvStore'

const isDev = import.meta.env.DEV
const warn = (...args: unknown[]) => { if (isDev) console.warn(...args) }

// Background playback (auto-PiP + audio-swap when the app is backgrounded) is a
// mobile feature: on a phone, leaving the app should keep the stream going. On
// desktop it's unwanted — switching tabs/windows would pop an unrequested PiP
// window that keeps playing. Gate it to touch devices (primary pointer coarse).
const backgroundPlaybackEnabled =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

// True when the video is already showing in a floating PiP window — either the
// standard API (Android/desktop) or iOS Safari's webkit presentation mode.
// Detaching HLS to swap to audio while in PiP would freeze that window.
function isVideoInPiP(video: HTMLVideoElement): boolean {
  const webkitMode = (video as HTMLVideoElement & { webkitPresentationMode?: string })
    .webkitPresentationMode
  return document.pictureInPictureElement === video || webkitMode === 'picture-in-picture'
}

interface VideoPlayerProps {
  channel: Channel
  /** Bumped by the retry button to force a fresh resolve (cache-bypassing). */
  retryNonce?: number
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
  function VideoPlayer({ channel, retryNonce = 0, onFallbackToIframe }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const hlsRef = useRef<Hls | null>(null)
    const isSwappedRef = useRef(false)
    // Always points at the active channel, so the async error handler (which
    // outlives the render that created it) reads the current channel rather
    // than a stale closure.
    const channelRef = useRef(channel)
    // Bounds the network-error re-resolve loop so a permanently-failing token
    // can't hammer the resolver/CDN forever.
    const resolveAttemptsRef = useRef(0)
    const setLoading = useTvStore((s) => s.setLoading)
    const setError = useTvStore((s) => s.setError)
    // Autoplay with sound is blocked without a user gesture (e.g. cold PWA
    // launch) — show a tap-to-play affordance instead of a silent dead frame.
    const [showTapToPlay, setShowTapToPlay] = useState(false)

    const MAX_RESOLVE_ATTEMPTS = 3

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

      setShowTapToPlay(false)

      // Cleanup previous instance
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Keep only ~1 min of already-played video. 5 min (300s) holds
          // ~100MB on mobile, which gets the backgrounded PWA OOM-killed
          // (white screen / frozen splash on relaunch). DVR seek-back beyond
          // this re-fetches from the server.
          backBufferLength: 60,
          liveDurationInfinity: true,
          liveSyncDurationCount: 2,
        })
        hlsRef.current = hls

        hls.loadSource(url)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Healthy load — reset the re-resolve budget so a later token expiry
          // gets a fresh set of recovery attempts.
          resolveAttemptsRef.current = 0
          setLoading(false)
          setShowTapToPlay(false)
          video.play().then(() => setShowTapToPlay(false)).catch((err) => {
            // Autoplay blocked (no user gesture) — surface a tap-to-play button.
            if (err?.name === 'NotAllowedError') setShowTapToPlay(true)
          })
        })

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            const ch = channelRef.current
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // For dynamic-URL channels, re-resolve (token may have expired)
                if (ch.resolveUrl) {
                  // Bail out of the loop once we've exhausted our attempts.
                  if (resolveAttemptsRef.current >= MAX_RESOLVE_ATTEMPTS) {
                    warn('Re-resolve attempts exhausted, giving up')
                    hls.destroy()
                    if (ch.fallbackUrl) {
                      onFallbackToIframe?.(ch.fallbackUrl)
                    } else {
                      setError('שגיאה בטעינת השידור')
                    }
                    return
                  }
                  resolveAttemptsRef.current += 1
                  const attempt = resolveAttemptsRef.current
                  const channelId = ch.id
                  warn(`Network error on dynamic stream, re-resolving URL (attempt ${attempt})...`)
                  hls.destroy()
                  // force=true bypasses the resolver cache so we don't reload the
                  // same rejected token.
                  ch.resolveUrl(true).then((freshUrl) => {
                    // Channel changed while resolving — abandon this load.
                    if (channelRef.current.id !== channelId) return
                    loadStream(freshUrl)
                  }).catch(() => {
                    if (channelRef.current.id !== channelId) return
                    if (ch.fallbackUrl) {
                      onFallbackToIframe?.(ch.fallbackUrl)
                    } else {
                      setError('שגיאה בטעינת השידור')
                    }
                  })
                  return
                }
                // Try fallback URL
                if (ch.fallbackUrl && url !== ch.fallbackUrl) {
                  warn('Primary URL failed, trying fallback...')
                  if (!ch.fallbackUrl.endsWith('.m3u8')) {
                    // Fallback is an iframe URL
                    hls.destroy()
                    onFallbackToIframe?.(ch.fallbackUrl)
                    return
                  }
                  loadStream(ch.fallbackUrl)
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
          const ch = channelRef.current
          if (ch.fallbackUrl && url !== ch.fallbackUrl) {
            if (!ch.fallbackUrl.endsWith('.m3u8')) {
              onFallbackToIframe?.(ch.fallbackUrl)
              return
            }
            loadStream(ch.fallbackUrl)
          } else {
            setError('שגיאה בטעינת השידור')
          }
        }, { once: true })
      } else {
        setError('הדפדפן אינו תומך בהפעלת וידאו')
      }
    }, [setLoading, setError, onFallbackToIframe])

    // Load stream on channel change — resolve dynamic URL if needed
    useEffect(() => {
      let cancelled = false
      // Keep the latest-channel ref and reset the re-resolve budget for the
      // newly selected channel.
      channelRef.current = channel
      resolveAttemptsRef.current = 0
      setLoading(true)

      if (channel.resolveUrl) {
        // On retry, bypass any cached/stale URL the resolver may be holding.
        channel.resolveUrl(retryNonce > 0).then((url) => {
          if (!cancelled) loadStream(url)
        }).catch((err) => {
          if (!cancelled) {
            warn('Failed to resolve stream URL:', err)
            // Resolver may attach a Hebrew `userMessage` for cases like a stale
            // upstream where we'd rather show the truth than silently iframe to
            // a blocked page or play 30 seconds of yesterday's news on loop.
            const userMsg = (err && typeof err === 'object' && 'userMessage' in err)
              ? (err as { userMessage?: string }).userMessage
              : undefined
            if (userMsg) {
              setError(userMsg)
            } else if (channel.fallbackUrl) {
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
    }, [channel, retryNonce, loadStream, setLoading, setError, onFallbackToIframe])

    // Background playback: auto-PiP first, fall back to audio swap
    useEffect(() => {
      const swapToAudio = () => {
        const hls = hlsRef.current
        const audio = audioRef.current
        const video = videoRef.current
        if (!hls || !audio || isSwappedRef.current) return
        const resumeAt = video?.currentTime
        hls.detachMedia()
        hls.attachMedia(audio)
        // Preserve the playback position so audio doesn't jump on the swap.
        if (resumeAt != null) {
          audio.addEventListener('loadedmetadata', () => { audio.currentTime = resumeAt }, { once: true })
        }
        audio.play().catch(() => {})
        isSwappedRef.current = true
      }

      const onVisibility = () => {
        const video = videoRef.current
        const audio = audioRef.current
        const hls = hlsRef.current

        if (document.visibilityState === 'hidden' && video && backgroundPlaybackEnabled) {
          // Already in a PiP window (manual button, or fullscreen-swipe native
          // auto-PiP) — leave it; swapping to audio would detach & freeze it.
          if (isVideoInPiP(video)) return
          // Otherwise give the native `autopictureinpicture` attribute a beat to
          // engage (the fullscreen-swipe → floating-video path); if no PiP
          // window appears, fall back to audio-only so playback always
          // continues in the background. The short delay is what removes the
          // race that previously froze the video or dropped playback entirely.
          // (We don't call requestPictureInPicture() here — it needs a user
          // gesture and is rejected from visibilitychange.)
          window.setTimeout(() => {
            if (document.visibilityState === 'hidden' && !isVideoInPiP(video)) {
              swapToAudio()
            }
          }, 300)
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
            // Not swapped (was in PiP or native HLS) — seek to live edge for
            // genuinely live streams only (VOD/ENDLIST keeps its position).
            if (hls && video.duration === Infinity) {
              const pos = hls.liveSyncPosition
              if (pos != null) video.currentTime = pos
            }
            video.play().catch(() => {})
          }
        }
      }

      // If PiP closes while still in background, fall back to audio (mobile only)
      const onLeavePiP = () => {
        if (backgroundPlaybackEnabled && document.visibilityState === 'hidden') swapToAudio()
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
          autopictureinpicture={backgroundPlaybackEnabled ? '' : undefined}
        />
        <audio ref={audioRef} hidden />
        {showTapToPlay && (
          <button
            onClick={() => {
              const v = videoRef.current
              v?.play().then(() => setShowTapToPlay(false)).catch(() => {})
            }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 transition"
            aria-label="הקש לצפייה"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/30">
              <svg viewBox="0 0 24 24" className="h-7 w-7 translate-x-0.5 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </>
    )
  },
)
