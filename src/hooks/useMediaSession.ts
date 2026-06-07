import { useEffect } from 'react'
import type { Channel } from '../types'

function mimeForLogo(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/png'
  }
}

export function useMediaSession(
  channel: Channel,
  onNext: () => void,
  onPrev: () => void,
  onPlayPause: () => void,
) {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.metadata = new MediaMetadata({
      title: channel.name,
      artist: 'שידור חי',
      album: 'טלוויזיה ישראלית',
      artwork: [
        { src: channel.logo, sizes: '192x192', type: mimeForLogo(channel.logo) },
      ],
    })

    navigator.mediaSession.playbackState = 'playing'

    navigator.mediaSession.setActionHandler('nexttrack', onNext)
    navigator.mediaSession.setActionHandler('previoustrack', onPrev)
    navigator.mediaSession.setActionHandler('play', () => {
      onPlayPause()
      navigator.mediaSession.playbackState = 'playing'
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      onPlayPause()
      navigator.mediaSession.playbackState = 'paused'
    })

    return () => {
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
    }
  }, [channel, onNext, onPrev, onPlayPause])
}
