import { useEffect } from 'react'
import type { Channel } from '../types'

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
        { src: channel.logo, sizes: '192x192', type: 'image/svg+xml' },
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
