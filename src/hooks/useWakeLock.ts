import { useEffect, useRef } from 'react'

export function useWakeLock(enabled: boolean) {
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return

    const acquire = async () => {
      try {
        if (enabled && document.visibilityState === 'visible') {
          wakeLock.current = await navigator.wakeLock.request('screen')
        }
      } catch {
        // Wake lock request failed (e.g., low battery)
      }
    }

    const release = () => {
      wakeLock.current?.release()
      wakeLock.current = null
    }

    if (enabled) {
      acquire()
      // Re-acquire on visibility change (released automatically when tab hidden)
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && enabled) acquire()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        release()
      }
    } else {
      release()
    }
  }, [enabled])
}
