import { useEffect, useState } from 'react'
import { isTablet, orientationLog, requestOrientation } from '../../hooks/useOrientationLock'

/** What the device reports about its screen and rotation. Opened by tapping the version 5 times. */
function snapshot() {
  const o = screen.orientation
  const mode = ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find((m) => window.matchMedia(`(display-mode: ${m})`).matches)
  return [
    ['מצב תצוגה', mode ?? '?'],
    ['מסך (CSS px)', `${screen.width}×${screen.height}`],
    ['חלון', `${innerWidth}×${innerHeight}`],
    ['צפיפות פיקסלים', String(devicePixelRatio)],
    ['זוהה כטאבלט', isTablet() ? 'כן' : 'לא'],
    ['כיוון', o ? `${o.type} (${o.angle}°)` : 'לא ידוע'],
    ['פריסה', window.matchMedia('(orientation: landscape)').matches ? 'לרוחב' : 'לאורך'],
  ]
}

export function OrientationDebug({ onClose }: { onClose: () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const tryLock = (type: 'any' | 'landscape' | 'portrait') => () => { void requestOrientation(type).then(() => setTick((n) => n + 1)) }

  return (
    <div dir="rtl" className="fixed inset-x-3 bottom-3 z-50 rounded-xl bg-neutral-900/95 p-4 text-xs text-white shadow-2xl ring-1 ring-white/15">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">בדיקת סיבוב מסך</b>
        <button onClick={onClose} className="rounded bg-white/10 px-2 py-1">סגור</button>
      </div>
      <table className="w-full">
        <tbody>
          {snapshot().map(([k, v]) => (
            <tr key={k}><td className="py-0.5 text-white/60">{k}</td><td dir="ltr" className="py-0.5 text-left font-mono">{v}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={tryLock('any')} className="rounded bg-white/10 px-2 py-1">שחרר סיבוב</button>
        <button onClick={tryLock('landscape')} className="rounded bg-white/10 px-2 py-1">נעל לרוחב</button>
        <button onClick={tryLock('portrait')} className="rounded bg-white/10 px-2 py-1">נעל לאורך</button>
      </div>
      <div dir="ltr" className="mt-2 max-h-28 overflow-y-auto font-mono text-[11px] text-white/70">
        {orientationLog.length ? orientationLog.map((l, i) => <div key={i}>{l}</div>) : 'no lock calls yet'}
      </div>
    </div>
  )
}
