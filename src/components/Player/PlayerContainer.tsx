import { useRef, useCallback, useState, useEffect } from 'react'
import { VideoPlayer } from './VideoPlayer'
import type { VideoPlayerHandle } from './VideoPlayer'
import { IframePlayer } from './IframePlayer'
import { PlayerControls } from './PlayerControls'
import { Spinner } from '../ui/Spinner'
import { useTvStore } from '../../stores/tvStore'
import { usePiP } from '../../hooks/usePiP'
import { useMediaSession } from '../../hooks/useMediaSession'
import { useWakeLock } from '../../hooks/useWakeLock'
import type { Channel } from '../../types'

const CONTROLS_TIMEOUT = 5000

export function PlayerContainer() {
  const currentChannel = useTvStore((s) => s.currentChannel)
  const isLoading = useTvStore((s) => s.isLoading)
  const error = useTvStore((s) => s.error)
  const nextChannel = useTvStore((s) => s.nextChannel)
  const prevChannel = useTvStore((s) => s.prevChannel)

  // When HLS fails and fallback is an iframe URL, override to iframe mode
  const [iframeFallback, setIframeFallback] = useState<{ channelId: string; url: string } | null>(null)
  // Incremented by the retry button to force VideoPlayer to re-run its resolve
  // effect (with `force=true`, bypassing the resolver cache). `setChannel` with
  // the same channel object wouldn't trigger the effect on its own.
  const [retryNonce, setRetryNonce] = useState(0)

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

  // Clear iframe fallback and retry counter when channel changes
  useEffect(() => {
    setIframeFallback(null)
    setRetryNonce(0)
  }, [currentChannel.id])

  const playerRef = useRef<VideoPlayerHandle>(null)
  const videoElementRef = useRef<HTMLVideoElement>(null)

  // Sync video element ref for PiP
  const updateVideoRef = useCallback(() => {
    const video = playerRef.current?.getVideo()
    if (video) {
      (videoElementRef as React.MutableRefObject<HTMLVideoElement | null>).current = video
    }
  }, [])

  // Run on every render to keep the PiP video ref in sync.
  queueMicrotask(updateVideoRef)

  const { isPiP, isSupported: isPiPSupported, togglePiP } = usePiP(videoElementRef)

  const onPlayPause = useCallback(() => {
    playerRef.current?.togglePlay()
  }, [])

  const onFallbackToIframe = useCallback((url: string) => {
    setIframeFallback({ channelId: currentChannel.id, url })
    useTvStore.getState().setLoading(true)
  }, [currentChannel.id])

  useMediaSession(currentChannel, nextChannel, prevChannel, onPlayPause)
  useWakeLock(true)

  // Determine if we should show iframe (either native iframe channel, or HLS fell back to iframe)
  const showIframe = currentChannel.type === 'iframe' ||
    (iframeFallback && iframeFallback.channelId === currentChannel.id)
  const isHls = !showIframe

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
        />
      ) : (
        <IframePlayer channel={iframeChannel!} />
      )}

      {/* Now-playing channel label — fades with the controls */}
      <div
        className={`pointer-events-none absolute top-0 inset-x-0 bg-gradient-to-b from-black/70 to-transparent p-3 transition-opacity duration-300 ${
          showControls && !error ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white drop-shadow">
          <img src={currentChannel.logo} alt="" className="h-5 w-5 rounded" />
          {currentChannel.name}
        </span>
      </div>

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
            onClick={() => {
              setIframeFallback(null)
              setRetryNonce((n) => n + 1)
              useTvStore.getState().setError(null)
              useTvStore.getState().setLoading(true)
            }}
            className="mt-1 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-95"
          >
            נסה שוב
          </button>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-8 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <PlayerControls
          playerRef={playerRef}
          isHls={isHls}
          isPiPSupported={isPiPSupported && isHls}
          onPiPToggle={togglePiP}
          isPiP={isPiP}
        />
      </div>
    </div>
  )
}
