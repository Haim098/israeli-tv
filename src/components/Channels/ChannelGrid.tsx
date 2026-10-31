import { useEffect } from 'react'
import { ChannelCard } from './ChannelCard'
import { useTvStore } from '../../stores/tvStore'
import { scheduleIdleWarmup, warmChannel } from '../../lib/warmup'

export function ChannelGrid() {
  const channels = useTvStore((s) => s.channels)
  const currentChannel = useTvStore((s) => s.currentChannel)
  const setChannel = useTvStore((s) => s.setChannel)

  // Pre-resolve the token/liveness channels in the background once the
  // current channel is playing, so switching to them starts immediately.
  useEffect(() => scheduleIdleWarmup(channels, (onPlaying) => {
    if (useTvStore.getState().isPlaying) onPlaying()
    return useTvStore.subscribe((s) => { if (s.isPlaying) onPlaying() })
  }), [channels])

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 wide:grid-cols-2 short:gap-2">
      {channels.map((channel) => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          isActive={currentChannel.id === channel.id}
          onSelect={() => setChannel(channel)}
          onIntent={() => warmChannel(channel)}
        />
      ))}
    </div>
  )
}
