import { useEffect } from 'react'
import type { Channel } from '../../types'
import { useTvStore } from '../../stores/tvStore'

interface IframePlayerProps {
  channel: Channel
}

export function IframePlayer({ channel }: IframePlayerProps) {
  const setLoading = useTvStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(true)
  }, [channel.id, setLoading])

  return (
    <div className="relative h-full w-full bg-black">
      <iframe
        key={channel.id}
        src={channel.streamUrl}
        className="h-full w-full border-0"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        onLoad={() => setLoading(false)}
        title={channel.name}
      />
      <div className="absolute bottom-2 start-2 rounded bg-black/70 px-2 py-1 text-xs text-white/70">
        שידור דרך האתר הרשמי
      </div>
    </div>
  )
}
