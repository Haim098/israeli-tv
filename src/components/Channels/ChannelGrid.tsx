import { ChannelCard } from './ChannelCard'
import { useTvStore } from '../../stores/tvStore'

export function ChannelGrid() {
  const channels = useTvStore((s) => s.channels)
  const currentChannel = useTvStore((s) => s.currentChannel)
  const setChannel = useTvStore((s) => s.setChannel)

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
      {channels.map((channel) => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          isActive={currentChannel.id === channel.id}
          onSelect={() => setChannel(channel)}
        />
      ))}
    </div>
  )
}
