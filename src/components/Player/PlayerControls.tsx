import { useState, useCallback, useEffect } from 'react'
import { LiveBadge } from './LiveBadge'
import { SeekBar } from './SeekBar'
import type { VideoPlayerHandle } from './VideoPlayer'

interface PlayerControlsProps {
  playerRef: React.RefObject<VideoPlayerHandle | null>
  isHls: boolean
  isPiPSupported: boolean
  onPiPToggle: () => void
  isPiP: boolean
}

export function PlayerControls({ playerRef, isHls, isPiPSupported, onPiPToggle, isPiP }: PlayerControlsProps) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(false)

  const syncState = useCallback(() => {
    const video = playerRef.current?.getVideo()
    if (video) {
      setIsPlaying(!video.paused)
      setIsMuted(video.muted)
    }
  }, [playerRef])

  useEffect(() => {
    const video = playerRef.current?.getVideo()
    if (!video) return
    const events = ['play', 'pause', 'volumechange'] as const
    events.forEach((e) => video.addEventListener(e, syncState))
    return () => events.forEach((e) => video.removeEventListener(e, syncState))
  }, [playerRef, syncState])

  const togglePlay = () => playerRef.current?.togglePlay()

  const toggleMute = () => {
    const video = playerRef.current?.getVideo()
    if (video) {
      video.muted = !video.muted
      setIsMuted(video.muted)
    }
  }

  const toggleFullscreen = () => {
    const video = playerRef.current?.getVideo()
    if (!video) return
    const container = video.closest('.player-container')
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      (container ?? video).requestFullscreen?.()
    }
  }

  return (
    <div className="flex flex-col">
      {/* Timeline / seek bar – HLS streams with DVR window only */}
      {isHls && <SeekBar playerRef={playerRef} />}

      <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <LiveBadge />
      </div>

      <div className="flex items-center gap-1">
        {isHls && (
          <>
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label={isPlaying ? 'השהה' : 'הפעל'}
            >
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            {/* Mute */}
            <button
              onClick={toggleMute}
              className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label={isMuted ? 'בטל השתקה' : 'השתק'}
            >
              {isMuted ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L20.56 12l1.72-1.72a.75.75 0 00-1.06-1.06l-1.72 1.72-1.72-1.72z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 01-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                  <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
                </svg>
              )}
            </button>

            {/* PiP */}
            {isPiPSupported && (
              <button
                onClick={onPiPToggle}
                className={`rounded-lg p-2 transition hover:bg-white/10 ${isPiP ? 'text-blue-400' : 'text-white/80 hover:text-white'}`}
                aria-label="תמונה בתוך תמונה"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M2.25 5.25a3 3 0 013-3h13.5a3 3 0 013 3V12a.75.75 0 01-1.5 0V5.25a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v13.5a1.5 1.5 0 001.5 1.5h4.5a.75.75 0 010 1.5h-4.5a3 3 0 01-3-3V5.25z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M13.5 14.25a.75.75 0 01.75-.75h6a.75.75 0 01.75.75v6a.75.75 0 01-.75.75h-6a.75.75 0 01-.75-.75v-6z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </>
        )}

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
          aria-label="מסך מלא"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3" />
          </svg>
        </button>
      </div>
    </div>
    </div>
  )
}
