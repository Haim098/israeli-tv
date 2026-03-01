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

export function PlayerContainer() {
  const currentChannel = useTvStore((s) => s.currentChannel)
  const isLoading = useTvStore((s) => s.isLoading)
  const error = useTvStore((s) => s.error)
  const nextChannel = useTvStore((s) => s.nextChannel)
  const prevChannel = useTvStore((s) => s.prevChannel)

  // When HLS fails and fallback is an iframe URL, override to iframe mode
  const [iframeFallback, setIframeFallback] = useState<{ channelId: string; url: string } | null>(null)

  // Clear iframe fallback when channel changes
  useEffect(() => {
    setIframeFallback(null)
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

  // Run on every render to keep ref in sync
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
    <div className="flex flex-col">
      {/* Video area with 16:9 aspect ratio */}
      <div className="player-container relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        {isHls ? (
          <VideoPlayer
            ref={playerRef}
            channel={currentChannel}
            onFallbackToIframe={onFallbackToIframe}
          />
        ) : (
          <IframePlayer channel={iframeChannel!} />
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Spinner />
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => {
                setIframeFallback(null)
                useTvStore.getState().setError(null)
                useTvStore.getState().setChannel(currentChannel)
              }}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20"
            >
              נסה שוב
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <PlayerControls
        playerRef={playerRef}
        isHls={isHls}
        isPiPSupported={isPiPSupported && isHls}
        onPiPToggle={togglePiP}
        isPiP={isPiP}
      />
    </div>
  )
}
