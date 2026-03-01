import type { Channel } from '../../types'

interface ChannelCardProps {
  channel: Channel
  isActive: boolean
  onSelect: () => void
}

export function ChannelCard({ channel, isActive, onSelect }: ChannelCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`
        relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-200
        ${isActive
          ? 'channel-active-glow scale-[1.03] border-2 bg-white/10'
          : 'border-2 border-transparent bg-surface-light hover:bg-surface-lighter active:scale-95'
        }
      `}
      style={{
        borderColor: isActive ? channel.color : undefined,
        '--glow-color': `${channel.color}66`,
      } as React.CSSProperties}
      aria-label={`${channel.name} - ערוץ ${channel.number}`}
      aria-pressed={isActive}
    >
      {/* Logo */}
      <img
        src={channel.logo}
        alt={channel.name}
        className="h-14 w-14 rounded-xl"
        loading="lazy"
      />

      {/* Channel name */}
      <span className="text-sm font-semibold text-white/90">{channel.name}</span>

      {/* Channel type indicator */}
      {channel.type === 'iframe' && (
        <span className="absolute top-1.5 end-1.5 rounded bg-white/10 px-1 py-0.5 text-[10px] text-white/50">
          אתר
        </span>
      )}

      {/* Active indicator dot */}
      {isActive && (
        <span
          className="absolute -top-1 start-1/2 h-2 w-2 -translate-x-1/2 rounded-full"
          style={{ backgroundColor: channel.color }}
        />
      )}
    </button>
  )
}
