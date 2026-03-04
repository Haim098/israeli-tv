import { useState, useEffect, useCallback, useRef } from 'react'
import type { VideoPlayerHandle } from './VideoPlayer'

interface SeekBarProps {
  playerRef: React.RefObject<VideoPlayerHandle | null>
}

const MIN_DVR_SEC = 30

export function SeekBar({ playerRef }: SeekBarProps) {
  const [seekableStart, setSeekableStart] = useState(0)
  const [seekableEnd, setSeekableEnd] = useState(0)
  const isDraggingRef = useRef(false)
  const [sliderValue, setSliderValue] = useState(0)

  const updateState = useCallback(() => {
    if (isDraggingRef.current) return
    const handle = playerRef.current
    if (!handle) return

    const time = handle.getCurrentTime()
    const range = handle.getSeekableRange()

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

  // Don't show seekbar if DVR window is too small
  if (duration < MIN_DVR_SEC) return null

  const sliderPercent = duration > 0 ? Math.min(100, (sliderValue / duration) * 100) : 100

  const handleMouseDown = () => {
    isDraggingRef.current = true
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setSliderValue(val)
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

    </div>
  )
}
