interface LiveBadgeProps {
  isAtLive?: boolean
  onGoLive?: () => void
}

export function LiveBadge({ isAtLive = true, onGoLive }: LiveBadgeProps) {
  return (
    <button
      onClick={onGoLive}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition active:scale-95 ${
        isAtLive
          ? 'bg-red-600 text-white'
          : 'animate-pulse bg-white/15 text-white/80 hover:bg-red-600 hover:text-white'
      }`}
      aria-label={isAtLive ? 'שידור חי' : 'חזרה לשידור חי'}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          isAtLive ? 'animate-pulse bg-white' : 'bg-white/60'
        }`}
      />
      {isAtLive ? 'שידור חי' : 'חזרה ללייב'}
    </button>
  )
}
