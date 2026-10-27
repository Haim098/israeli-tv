import { useRef, useCallback, useState, useEffect } from 'react'
import { VideoPlayer } from './VideoPlayer'
import type { VideoPlayerHandle } from './VideoPlayer'
import { IframePlayer } from './IframePlayer'
import { PlayerControls } from './PlayerControls'
import { Spinner } from '../ui/Spinner'
import { AVDebug } from './AVDebug'
import { isAVDebugEnabled } from '../../lib/avDebug'
import { useTvStore } from '../../stores/tvStore'
import { usePiP } from '../../hooks/usePiP'
import { useMediaSession } from '../../hooks/useMediaSession'
import { useWakeLock } from '../../hooks/useWakeLock'
import type { Channel } from '../../types'

const CONTROLS_TIMEOUT = 5000
// Max gap between taps for a double-tap (and for chaining further skips).
const DOUBLE_TAP_MS = 300
const SKIP_SECONDS = 10

type SkipSide = 'back' | 'fwd'

export function PlayerContainer() {
  const currentChannel = useTvStore((s) => s.currentChannel)
  const isLoading = useTvStore((s) => s.isLoading)
  const error = useTvStore((s) => s.error)
  const isPlaying = useTvStore((s) => s.isPlaying)
  const nextChannel = useTvStore((s) => s.nextChannel)
  const prevChannel = useTvStore((s) => s.prevChannel)

  // When HLS fails and fallback is an iframe URL, override to iframe mode
  const [iframeFallback, setIframeFallback] = useState<{ channelId: string; url: string } | null>(null)
  // Incremented by the retry button to force VideoPlayer to re-run its resolve
  // effect (with `force=true`, bypassing the resolver cache). `setChannel` with
  // the same channel object wouldn't trigger the effect on its own. Keyed by
  // channel so it reads as 0 the moment the channel changes — resetting it in
  // an effect instead made the first switch after a retry load the new
  // channel twice (and bypass its resolver cache). It is also dropped (during
  // render, before anything commits) as soon as the channel changes, so coming
  // back to a channel you once retried loads it normally instead of forcing a
  // fresh token again.
  const [retryState, setRetryState] = useState({ channelId: currentChannel.id, nonce: 0 })
  if (retryState.channelId !== currentChannel.id) {
    setRetryState({ channelId: currentChannel.id, nonce: 0 })
  }
  const retryNonce = retryState.channelId === currentChannel.id ? retryState.nonce : 0

  // Auto-hide controls
  const [showControls, setShowControls] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_TIMEOUT)
  }, [])

  // Start the initial hide timer
  useEffect(() => {
    resetControlsTimer()
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [resetControlsTimer])

  // Clear iframe fallback when channel changes
  useEffect(() => {
    setIframeFallback(null)
  }, [currentChannel.id])

  const playerRef = useRef<VideoPlayerHandle>(null)
  const [avDebug] = useState(isAVDebugEnabled)
  // The <video> element as state: hooks/controls re-bind their listeners when
  // VideoPlayer remounts (e.g. after an iframe fallback + retry).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  const { isPiP, isSupported: isPiPSupported, togglePiP } = usePiP(videoEl)

  const onPlay = useCallback(() => playerRef.current?.play(), [])
  const onPause = useCallback(() => playerRef.current?.pause(), [])

  const retry = useCallback(() => {
    setIframeFallback(null)
    const channelId = useTvStore.getState().currentChannel.id
    setRetryState((prev) => ({
      channelId,
      nonce: (prev.channelId === channelId ? prev.nonce : 0) + 1,
    }))
    useTvStore.getState().setError(null)
    useTvStore.getState().setLoading(true)
  }, [])

  // Network came back: retry a failed stream, or nudge a stalled one.
  useEffect(() => {
    const onOnline = () => {
      if (useTvStore.getState().error) retry()
      else playerRef.current?.recover()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [retry])

  // Double-tap the left/right side of the video to skip back/forward 10s
  // (further quick taps keep adding, like YouTube).
  const lastTapRef = useRef<{ time: number; side: SkipSide | null }>({ time: 0, side: null })
  // `id` changes on every skip so the indicator remounts and its animation
  // restarts, even when chained taps keep it on screen.
  const [skipFlash, setSkipFlash] = useState<{ side: SkipSide; seconds: number; id: number } | null>(null)
  const skipFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (skipFlashTimerRef.current) clearTimeout(skipFlashTimerRef.current) }, [])

  const onTapLayer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const side: SkipSide | null = x < 0.35 ? 'back' : x > 0.65 ? 'fwd' : null
    const now = performance.now()
    const last = lastTapRef.current
    lastTapRef.current = { time: now, side }
    if (!side || last.side !== side || now - last.time > DOUBLE_TAP_MS) return

    playerRef.current?.skip(side === 'fwd' ? SKIP_SECONDS : -SKIP_SECONDS)
    setSkipFlash((prev) => ({
      side,
      seconds: prev && prev.side === side ? prev.seconds + SKIP_SECONDS : SKIP_SECONDS,
      id: (prev?.id ?? 0) + 1,
    }))
    if (skipFlashTimerRef.current) clearTimeout(skipFlashTimerRef.current)
    skipFlashTimerRef.current = setTimeout(() => setSkipFlash(null), 820)
  }

  const onFallbackToIframe = useCallback((url: string) => {
    setIframeFallback({ channelId: currentChannel.id, url })
    useTvStore.getState().setLoading(true)
  }, [currentChannel.id])

  useMediaSession(currentChannel, nextChannel, prevChannel, onPlay, onPause)

  // Determine if we should show iframe (either native iframe channel, or HLS fell back to iframe)
  const showIframe = currentChannel.type === 'iframe' ||
    (iframeFallback && iframeFallback.channelId === currentChannel.id)
  const isHls = !showIframe

  // Keep the screen on only while something is actually playing (an iframe
  // channel's state is unknown, so keep it on there).
  useWakeLock(showIframe || isPlaying)

  // Keep the controls up while paused; once playback resumes, restart the
  // auto-hide timer.
  const controlsVisible = showControls || (isHls && !isPlaying)
  useEffect(() => useTvStore.subscribe((state, prev) => {
    if (state.isPlaying && !prev.isPlaying) resetControlsTimer()
  }), [resetControlsTimer])

  // Build the channel object for iframe fallback
  const iframeChannel: Channel | null = showIframe
    ? iframeFallback && iframeFallback.channelId === currentChannel.id
      ? { ...currentChannel, streamUrl: iframeFallback.url, type: 'iframe' }
      : currentChannel
    : null

  return (
    <div
      className="player-container relative aspect-video w-full overflow-hidden rounded-xl bg-black"
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={resetControlsTimer}
    >
      {isHls ? (
        <VideoPlayer
          ref={playerRef}
          channel={currentChannel}
          retryNonce={retryNonce}
          onFallbackToIframe={onFallbackToIframe}
          onVideoElement={setVideoEl}
        />
      ) : (
        <IframePlayer channel={iframeChannel!} />
      )}

      {/* Double-tap-to-skip layer (touch only), under the overlays/controls */}
      {isHls && (
        <div
          className="absolute inset-0 touch-manipulation"
          onPointerUp={onTapLayer}
          aria-hidden="true"
        />
      )}

      {/* Double-tap skip indicator: a soft shade on that side plus the
          seconds and a double chevron sliding in the skip direction. */}
      {skipFlash && (
        <div key={skipFlash.id} className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className={`skip-glow absolute inset-y-0 w-[46%] from-black/55 to-transparent ${
              skipFlash.side === 'fwd' ? 'right-0 bg-gradient-to-l' : 'left-0 bg-gradient-to-r'
            }`}
          />
          <div
            className={`absolute top-1/2 flex items-center gap-2 text-white ${
              skipFlash.side === 'fwd' ? 'skip-slide-fwd right-[9%]' : 'skip-slide-back left-[9%] flex-row-reverse'
            }`}
            dir="ltr"
          >
            <div className="flex flex-col items-center leading-none">
              <span className="text-3xl font-light tracking-tight">{skipFlash.seconds}</span>
              <span className="mt-1 text-[11px] font-medium text-white/75">שניות</span>
            </div>
            <svg
              viewBox="0 0 24 24"
              className={`h-[22px] w-[22px] ${skipFlash.side === 'back' ? '-scale-x-100' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l6 6-6 6" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </div>
        </div>
      )}

      {/* Now-playing channel label — fades with the controls */}
      <div
        className={`pointer-events-none absolute top-0 inset-x-0 bg-gradient-to-b from-black/70 to-transparent p-3 transition-opacity duration-300 ${
          controlsVisible && !error ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white drop-shadow">
          <img src={currentChannel.logo} alt="" className="h-5 w-5 rounded" />
          {currentChannel.name}
        </span>
      </div>

      {avDebug && isHls && <AVDebug video={videoEl} />}

      {/* Loading overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <Spinner label={`טוען ${currentChannel.name}…`} />
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
          <svg viewBox="0 0 24 24" className="h-10 w-10 fill-red-500" aria-hidden="true">
            <path d="M12 2 1 21h22L12 2zm0 14a1 1 0 110 2 1 1 0 010-2zm-1-7h2v5h-2V9z" />
          </svg>
          <p className="text-base font-semibold text-white">{error}</p>
          <p className="text-sm text-white/60">נסה שוב או בחר ערוץ אחר</p>
          <button
            onClick={retry}
            className="mt-1 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-95"
          >
            נסה שוב
          </button>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-8 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <PlayerControls
          playerRef={playerRef}
          video={videoEl}
          isHls={isHls}
          isPiPSupported={isPiPSupported && isHls}
          onPiPToggle={togglePiP}
          isPiP={isPiP}
        />
      </div>
    </div>
  )
}
