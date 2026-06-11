interface SpinnerProps {
  label?: string
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      {label && <p className="text-sm font-medium text-white/80">{label}</p>}
    </div>
  )
}
