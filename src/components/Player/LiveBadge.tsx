interface LiveBadgeProps {
  isAtLive?: boolean
  onGoLive?: () => void
}

export function LiveBadge({ isAtLive = true, onGoLive }: LiveBadgeProps) {
  return (
    <button
      onClick={onGoLive}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold transition ${
        isAtLive
          ? 'bg-red-600/90 text-white'
          : 'bg-white/20 text-white/60 hover:bg-red-600/70 hover:text-white'
      }`}
      aria-label="עבור לשידור חי"
    >
      <span
        className={`h-2 w-2 rounded-full ${
          isAtLive ? 'animate-pulse bg-white' : 'bg-white/40'
        }`}
      />
      שידור חי
    </button>
  )
}
