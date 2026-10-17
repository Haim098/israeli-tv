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

/**
 * Notification / lock-screen / PiP-window media controls.
 *
 * Play and pause are wired to explicit actions (not a toggle): a toggle can
 * invert the user's intent when the system button and the real player state
 * disagree. `playbackState` is kept in sync by VideoPlayer from the real
 * play/pause events, so the icon always reflects what is actually happening.
 */
export function useMediaSession(
  channel: Channel,
  onNext: () => void,
  onPrev: () => void,
  onPlay: () => void,
  onPause: () => void,
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

    navigator.mediaSession.setActionHandler('nexttrack', onNext)
    navigator.mediaSession.setActionHandler('previoustrack', onPrev)
    navigator.mediaSession.setActionHandler('play', onPlay)
    navigator.mediaSession.setActionHandler('pause', onPause)

    return () => {
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
    }
  }, [channel, onNext, onPrev, onPlay, onPause])
}
