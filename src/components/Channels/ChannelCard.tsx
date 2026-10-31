import type { Channel } from '../../types'

interface ChannelCardProps {
  channel: Channel
  isActive: boolean
  onSelect: () => void
  /** Called on press/hover, before the click — used to warm up the stream. */
  onIntent?: () => void
}

export function ChannelCard({ channel, isActive, onSelect, onIntent }: ChannelCardProps) {
  return (
    <button
      onClick={onSelect}
      // Press (touch) or hover (mouse) comes ~100ms+ before the click; start
      // warming the stream then.
      onPointerDown={isActive ? undefined : onIntent}
      onPointerEnter={isActive ? undefined : (e) => { if (e.pointerType === 'mouse') onIntent?.() }}
      className={`
        relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-200 short:gap-1 short:p-2
        ${isActive
          ? 'channel-active-glow scale-105 border-2 bg-white/10'
          : 'border-2 border-transparent bg-surface-light hover:bg-surface-lighter hover:scale-[1.02] active:scale-95'
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
        width={56}
        height={56}
        className="h-14 w-14 rounded-xl short:h-10 short:w-10"
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
    </button>
  )
}
