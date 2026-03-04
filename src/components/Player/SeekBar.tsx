import { useState, useEffect, useCallback, useRef } from 'react'
import type { VideoPlayerHandle } from './VideoPlayer'

interface SeekBarProps {
  playerRef: React.RefObject<VideoPlayerHandle | null>
}

function formatTimeBehind(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `-${s}s`
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `-${mins}:${secs.toString().padStart(2, '0')}`
}

const LIVE_THRESHOLD_SEC = 10
const MIN_DVR_SEC = 30

export function SeekBar({ playerRef }: SeekBarProps) {
  const [currentTime, setCurrentTime] = useState(0)
  const [seekableStart, setSeekableStart] = useState(0)
  const [seekableEnd, setSeekableEnd] = useState(0)
  const [liveSyncPos, setLiveSyncPos] = useState<number | null>(null)
  const isDraggingRef = useRef(false)
  const [sliderValue, setSliderValue] = useState(0)

  const updateState = useCallback(() => {
    if (isDraggingRef.current) return
    const handle = playerRef.current
    if (!handle) return

    const time = handle.getCurrentTime()
    const range = handle.getSeekableRange()
    const livePos = handle.getLiveSyncPosition()

    setCurrentTime(time)
    setLiveSyncPos(livePos)
    if (range) {
      setSeekableStart(range.start)
      setSeekableEnd(range.end)
      setSliderValue(Math.max(0, time - range.start))
    }
  }, [playerRef])

  useEffect(() => {
    const video = playerRef.current?.getVideo()
    if (!video) return
    video.addEventListener('timeupdate', updateState)
    video.addEventListener('progress', updateState)
    return () => {
      video.removeEventListener('timeupdate', updateState)
      video.removeEventListener('progress', updateState)
    }
  }, [playerRef, updateState])

  const duration = seekableEnd - seekableStart
  const liveEdge = liveSyncPos ?? seekableEnd
  const timeBehind = liveEdge - currentTime
  const isAtLive = timeBehind < LIVE_THRESHOLD_SEC

  // Don't show seekbar if DVR window is too small
  if (duration < MIN_DVR_SEC) return null

  const sliderPercent = duration > 0 ? Math.min(100, (sliderValue / duration) * 100) : 100

  const goLive = () => {
    const handle = playerRef.current
    if (!handle) return
    const livePos = handle.getLiveSyncPosition()
    const range = handle.getSeekableRange()
    const target = livePos ?? (range?.end ?? 0)
    handle.seekTo(target)
    handle.play()
  }

  const handleMouseDown = () => {
    isDraggingRef.current = true
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setSliderValue(val)
    setCurrentTime(seekableStart + val)
  }

  const handleCommit = () => {
    playerRef.current?.seekTo(seekableStart + sliderValue)
    isDraggingRef.current = false
  }

  return (
    <div className="flex items-center gap-2 px-3 pb-1" dir="ltr">
      <input
        type="range"
        min={0}
        max={duration}
        step={1}
        value={sliderValue}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
        onChange={handleChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        className="seek-bar flex-1"
        style={{
          background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${sliderPercent}%, rgba(255,255,255,0.2) ${sliderPercent}%, rgba(255,255,255,0.2) 100%)`,
        }}
        aria-label="ציר הזמן"
      />

      {!isAtLive && (
        <span className="shrink-0 text-xs text-white/50 tabular-nums">
          {formatTimeBehind(timeBehind)}
        </span>
      )}

      {!isAtLive && (
        <button
          onClick={goLive}
          className="shrink-0 rounded-md bg-red-600/90 px-2 py-0.5 text-xs font-bold text-white transition hover:bg-red-600"
          aria-label="עבור לשידור חי"
        >
          חי ▶
        </button>
      )}
    </div>
  )
}
