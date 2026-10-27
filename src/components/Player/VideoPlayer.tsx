import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import Hls from 'hls.js'
import type { Channel } from '../../types'
import { useTvStore } from '../../stores/tvStore'
import { keepAudioOutputAwake, releaseAudioOutput, setWatching } from '../../lib/audioKeepAlive'

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

// True when the whole app window has been shrunk into Android's system PiP
// (the fullscreen-swipe path). That path doesn't use the PiP web API, so there
// is no pictureInPictureElement — but the window becomes a small fraction of the
// screen. A maximised PiP window is still ~25% of a portrait phone screen, while
// split-screen is ~50%, so 35% separates them.
function isWindowInSystemPiP(): boolean {
  const screenArea = window.screen.width * window.screen.height
  if (!screenArea) return false
  return (window.innerWidth * window.innerHeight) / screenArea < 0.35
}

// hls.js starts every new instance assuming 500 kbps, so each channel switch
// began on a low rendition and switched up a few seconds later (a visible
// quality jump, and a level switch is where audio can drop out briefly).
// Carry the measured bandwidth over to the next channel instead.
let lastBandwidthEstimate: number | undefined

function rememberBandwidth(hls: Hls): void {
  const bwe = hls.bandwidthEstimate
  if (Number.isFinite(bwe) && bwe > 0) lastBandwidthEstimate = bwe
}

// How long to hold the audio output awake while a channel loads or a stream
// is stalled, and for how long after playback resumes (so the hand-over to
// the stream's own audio has no gap). See lib/audioKeepAlive.
const AUDIO_HOLD_LOADING_MS = 20_000
const AUDIO_HOLD_AFTER_PLAYING_MS = 3_000

interface VideoPlayerProps {
  channel: Channel
  /** Bumped by the retry button to force a fresh resolve (cache-bypassing). */
  retryNonce?: number
  onFallbackToIframe?: (url: string) => void
  /** Receives the <video> element on mount (and null on unmount). */
  onVideoElement?: (video: HTMLVideoElement | null) => void
}

export interface VideoPlayerHandle {
  getVideo: () => HTMLVideoElement | null
  play: () => void
  pause: () => void
  togglePlay: () => void
  isPlaying: () => boolean
  seekTo: (time: number) => void
  /** Jump by ±seconds, clamped to the seekable (DVR) window. */
  skip: (seconds: number) => void
  /** Kick a stalled stream back into loading (e.g. after the network returns). */
  recover: () => void
  getCurrentTime: () => number
  getSeekableRange: () => { start: number; end: number } | null
  getLiveSyncPosition: () => number | null
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ channel, retryNonce = 0, onFallbackToIframe, onVideoElement }, ref) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const hlsRef = useRef<Hls | null>(null)
    const isSwappedRef = useRef(false)
    // What the *user* wants: playing or paused. Background/foreground
    // transitions follow this instead of blindly resuming, so a video the user
    // paused stays paused when the app is left, a PiP window is closed, or the
    // app is reopened. Updated by explicit actions (controls, notification /
    // PiP buttons, tap-to-play) and by play/pause events while the page is
    // visible; ignored while hidden, where the browser itself pauses/detaches.
    const wantsPlayRef = useRef(true)
    // Listeners tied to the current load, dropped on the next load.
    const loadAbortRef = useRef<AbortController | null>(null)
    // Bumped every time the load effect runs (channel switch or retry), so an
    // async recovery started for an earlier load can tell it is stale — even
    // when the user has since come back to the same channel.
    const loadGenRef = useRef(0)
    // Always points at the active channel, so the async error handler (which
    // outlives the render that created it) reads the current channel rather
    // than a stale closure.
    const channelRef = useRef(channel)
    // Bounds the network-error re-resolve loop so a permanently-failing token
    // can't hammer the resolver/CDN forever.
    const resolveAttemptsRef = useRef(0)
    const setLoading = useTvStore((s) => s.setLoading)
    const setError = useTvStore((s) => s.setError)
    const setPlaying = useTvStore((s) => s.setPlaying)
    // Autoplay with sound is blocked without a user gesture (e.g. cold PWA
    // launch) — show a tap-to-play affordance instead of a silent dead frame.
    const [showTapToPlay, setShowTapToPlay] = useState(false)

    const MAX_RESOLVE_ATTEMPTS = 3

    const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
      videoRef.current = el
      onVideoElement?.(el)
    }, [onVideoElement])

    const activeEl = () => (isSwappedRef.current ? audioRef.current : videoRef.current)

    const play = useCallback(() => {
      wantsPlayRef.current = true
      activeEl()?.play().catch(() => {})
    }, [])

    const pause = useCallback(() => {
      wantsPlayRef.current = false
      activeEl()?.pause()
    }, [])

    useImperativeHandle(ref, () => ({
      getVideo: () => videoRef.current,
      play,
      pause,
      togglePlay: () => {
        const el = activeEl()
        if (!el) return
        if (el.paused) play()
        else pause()
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
      skip: (seconds: number) => {
        const el = activeEl()
        const video = videoRef.current
        if (!el || !video) return
        const target = el.currentTime + seconds
        el.currentTime = video.seekable.length > 0
          ? Math.max(video.seekable.start(0), Math.min(target, video.seekable.end(0)))
          : target
      },
      recover: () => {
        const hls = hlsRef.current
        const video = videoRef.current
        if (!hls || !video || isSwappedRef.current) return
        // Only nudge a stream that is actually starved — restarting a healthy
        // loader would cause a needless hiccup.
        if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          hls.startLoad(video.currentTime, true)
        }
        if (wantsPlayRef.current) video.play().catch(() => {})
      },
    }), [play, pause])

    const loadStream = useCallback((url: string) => {
      const video = videoRef.current
      if (!video) return

      setShowTapToPlay(false)
      loadAbortRef.current?.abort()
      loadAbortRef.current = null

      // Cleanup previous instance
      if (hlsRef.current) {
        rememberBandwidth(hlsRef.current)
        hlsRef.current.destroy()
        hlsRef.current = null
      }

      if (Hls.isSupported()) {
        // While backgrounded we play through the hidden <audio> element (the
        // browser pauses a hidden <video>). A switch made from the notification
        // / lock screen must load into that element too, or the new channel is
        // silent until the app is reopened.
        const target: HTMLMediaElement =
          isSwappedRef.current && audioRef.current ? audioRef.current : video
        const loadAbort = new AbortController()
        loadAbortRef.current = loadAbort
        // Keep the spinner until the picture actually moves, not just until
        // the playlist is parsed (which left a black frame with no spinner).
        target.addEventListener('playing', () => setLoading(false), {
          once: true,
          signal: loadAbort.signal,
        })

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
          // Fetch the first fragment while MediaSource is still being attached
          // instead of waiting for it — shaves time off every channel start.
          startFragPrefetch: true,
          // Start at the beginning of the first loaded segment, not part-way
          // into it. Starting mid-segment left as little as ~2s buffered
          // ahead, so playback often froze (and went silent) a moment after
          // it began, and the decoder first had to churn through the
          // segment's leading frames just to reach the start point.
          startOnSegmentBoundary: true,
          ...(lastBandwidthEstimate ? { abrEwmaDefaultEstimate: lastBandwidthEstimate } : {}),
        })
        hlsRef.current = hls

        hls.loadSource(url)
        hls.attachMedia(target)

        hls.on(Hls.Events.FRAG_LOADED, () => rememberBandwidth(hls))

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Healthy load — reset the re-resolve budget so a later token expiry
          // gets a fresh set of recovery attempts.
          resolveAttemptsRef.current = 0
          setShowTapToPlay(false)
          target.play().then(() => setShowTapToPlay(false)).catch((err) => {
            // Autoplay blocked (no user gesture) — surface a tap-to-play button.
            if (err?.name === 'NotAllowedError') {
              setLoading(false)
              if (target === video) setShowTapToPlay(true)
            }
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
                  const gen = loadGenRef.current
                  warn(`Network error on dynamic stream, re-resolving URL (attempt ${attempt})...`)
                  hls.destroy()
                  // force=true bypasses the resolver cache so we don't reload the
                  // same rejected token.
                  ch.resolveUrl(true).then((freshUrl) => {
                    // Channel changed (or was reloaded) while resolving —
                    // abandon this load.
                    if (loadGenRef.current !== gen) return
                    loadStream(freshUrl)
                  }).catch(() => {
                    if (loadGenRef.current !== gen) return
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
        // iOS Safari — native HLS. Tie the one-shot listeners to this load so
        // a channel switch drops them instead of letting a stale error handler
        // fire (with the old URL) on the next channel.
        const loadAbort = new AbortController()
        loadAbortRef.current = loadAbort
        video.src = url
        video.addEventListener('loadedmetadata', () => {
          setLoading(false)
          video.play().catch(() => {})
        }, { once: true, signal: loadAbort.signal })

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
        }, { once: true, signal: loadAbort.signal })
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
      loadGenRef.current += 1
      // A freshly selected channel should start playing.
      wantsPlayRef.current = true
      setLoading(true)
      // The old channel's audio stops now; keep the output device awake
      // until the new one starts.
      keepAudioOutputAwake(AUDIO_HOLD_LOADING_MS)

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
        loadAbortRef.current?.abort()
        loadAbortRef.current = null
        if (hlsRef.current) {
          hlsRef.current.destroy()
          hlsRef.current = null
        }
      }
    }, [channel, retryNonce, loadStream, setLoading, setError, onFallbackToIframe])

    // Mirror the real play state (of whichever element is active) into the
    // store — drives the wake lock and controls — and into the Media Session,
    // so the notification / Dynamic Island icon matches reality. While the
    // page is visible, play/pause events also record the user's intent (this
    // catches pause/play from places we don't route, like native controls).
    useEffect(() => {
      const video = videoRef.current
      const audio = audioRef.current
      const sync = (e: Event) => {
        if (e.target === video && document.visibilityState === 'visible' && !isSwappedRef.current) {
          if (e.type === 'play') wantsPlayRef.current = true
          else if (e.type === 'pause' && video?.currentSrc) wantsPlayRef.current = false
        }
        const el = isSwappedRef.current ? audio : video
        if (e.target === el) {
          // Bridge the silent gaps (stall, waiting for data) so the audio
          // output doesn't go idle and clip the sound when it resumes.
          if (e.type === 'waiting' && wantsPlayRef.current) keepAudioOutputAwake(AUDIO_HOLD_LOADING_MS)
          else if (e.type === 'playing') {
            keepAudioOutputAwake(AUDIO_HOLD_AFTER_PLAYING_MS)
            setWatching(document.visibilityState === 'visible')
          } else if (e.type === 'pause' && !wantsPlayRef.current) {
            releaseAudioOutput()
            setWatching(false)
          }
        }
        const playing = !!el && !el.paused
        setPlaying(playing)
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
        }
      }
      const events = ['play', 'pause', 'playing', 'emptied', 'waiting'] as const
      for (const el of [video, audio]) events.forEach((ev) => el?.addEventListener(ev, sync))
      return () => {
        for (const el of [video, audio]) events.forEach((ev) => el?.removeEventListener(ev, sync))
        setPlaying(false)
      }
    }, [setPlaying])

    // Background playback: auto-PiP first, fall back to audio swap — but only
    // when the user actually wants it playing.
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

      // Closing the floating window with X means "stop", like YouTube.
      const stopPlayback = () => {
        wantsPlayRef.current = false
        videoRef.current?.pause()
        audioRef.current?.pause()
      }

      // When the (visible) window shrank into system PiP. A hidden event only
      // counts as "closed with X" if the window had been sitting in PiP for a
      // while — not if it fires mid-transition while entering PiP.
      let systemPiPSince: number | null = null
      const onResize = () => {
        if (document.visibilityState === 'visible' && isWindowInSystemPiP()) {
          systemPiPSince ??= performance.now()
        } else {
          systemPiPSince = null
        }
      }

      const onVisibility = () => {
        const video = videoRef.current
        const audio = audioRef.current
        const hls = hlsRef.current

        // The keep-alive clip only matters while the app is on screen.
        setWatching(document.visibilityState === 'visible' && wantsPlayRef.current)

        if (document.visibilityState === 'hidden' && video && backgroundPlaybackEnabled) {
          // Paused by the user — leaving the app must not start anything.
          if (!wantsPlayRef.current) return
          // Already in a PiP-API window (manual button) — leave it; swapping to
          // audio would detach & freeze it.
          if (isVideoInPiP(video)) return
          // The app window was in Android's system PiP (fullscreen-swipe path)
          // and is now going away: that's the X button. Stop instead of
          // continuing as background audio.
          if (systemPiPSince != null && performance.now() - systemPiPSince > 1000 && isWindowInSystemPiP()) {
            systemPiPSince = null
            stopPlayback()
            return
          }
          // Otherwise give native auto-PiP a beat to engage; if no PiP window
          // appears, fall back to audio-only so playback continues in the
          // background. (requestPictureInPicture() can't be called here — it
          // needs a user gesture.)
          window.setTimeout(() => {
            if (document.visibilityState === 'hidden' && wantsPlayRef.current && !isVideoInPiP(video)) {
              swapToAudio()
            }
          }, 300)
        } else if (document.visibilityState === 'visible' && video) {
          onResize()
          // Exit PiP if active
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {})
          }

          const shouldPlay = wantsPlayRef.current
          if (isSwappedRef.current && hls && audio) {
            // Swap back from audio to video
            audio.pause()
            hls.detachMedia()
            hls.attachMedia(video)
            isSwappedRef.current = false
            video.addEventListener('canplay', () => {
              // A channel switched to while backgrounded may never have
              // started on the <audio> element, so clear its spinner here.
              useTvStore.getState().setLoading(false)
              if (!shouldPlay) return
              const pos = hls.liveSyncPosition
              if (pos != null) video.currentTime = pos
              video.play().catch(() => {})
            }, { once: true })
          } else if (shouldPlay) {
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

      // The PiP-API window closed while the app is in the background. Wait a
      // beat: tapping "expand" also fires this, followed by the page becoming
      // visible — only a close (X) leaves us hidden.
      const onLeavePiP = () => {
        if (!backgroundPlaybackEnabled || document.visibilityState !== 'hidden') return
        window.setTimeout(() => {
          if (document.visibilityState === 'hidden') stopPlayback()
        }, 500)
      }

      const video = videoRef.current
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('resize', onResize)
      video?.addEventListener('leavepictureinpicture', onLeavePiP)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('resize', onResize)
        video?.removeEventListener('leavepictureinpicture', onLeavePiP)
      }
    }, [])

    return (
      <>
        <video
          ref={setVideoRef}
          className="h-full w-full object-contain bg-black"
          playsInline
          webkit-playsinline=""
          autoPlay
          muted={false}
          // @ts-expect-error autopictureinpicture is not yet in TS types
          autopictureinpicture={backgroundPlaybackEnabled ? '' : undefined}
        />
        <audio ref={audioRef} hidden />
        {showTapToPlay && (
          <button
            onClick={() => {
              wantsPlayRef.current = true
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
