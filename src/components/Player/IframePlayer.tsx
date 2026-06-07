import { useEffect } from 'react'
import type { Channel } from '../../types'
import { useTvStore } from '../../stores/tvStore'

interface IframePlayerProps {
  channel: Channel
}

const IFRAME_LOAD_TIMEOUT = 15_000

export function IframePlayer({ channel }: IframePlayerProps) {
  const setLoading = useTvStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(true)
    // If the iframe never fires `load` (broken/blocked URL, cached same-src),
    // clear the spinner anyway so the player doesn't hang forever.
    const timer = setTimeout(() => setLoading(false), IFRAME_LOAD_TIMEOUT)
    return () => clearTimeout(timer)
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
