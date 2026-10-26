/**
 * Keep the phone's audio output awake across channel switches.
 *
 * A channel switch tears down the <video> element's media pipeline, so for
 * a second or more the browser plays nothing at all. On Android that lets
 * the audio output go idle; Bluetooth headphones / speakers / car audio
 * then need a moment to wake up again, and the new channel's first seconds
 * of sound are lost even though the picture is already playing. (A screen
 * recording captures the audio *before* the output device, so it looks in
 * sync there.)
 *
 * While a channel is loading or stalled we play an inaudible signal through
 * Web Audio. Its stream keeps the output (and the Bluetooth link) active
 * until the new channel's own audio takes over.
 */

const enabled =
  typeof navigator !== 'undefined' &&
  /Android/i.test(navigator.userAgent) &&
  typeof window !== 'undefined' &&
  'AudioContext' in window

// Far below anything audible (-120 dBFS), but not digital zero: Chrome
// stops feeding the output device after a stretch of exact-zero samples.
const LEVEL = 1e-6

let ctx: AudioContext | null = null
let releaseTimer: ReturnType<typeof setTimeout> | undefined

function getContext(): AudioContext | null {
  if (ctx) return ctx
  // Without a user gesture yet, Chrome refuses to start an AudioContext (and
  // logs a warning). The first channel tap provides one.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  if (activation && !activation.hasBeenActive) return null
  try {
    ctx = new AudioContext({ latencyHint: 'playback' })
    const source = ctx.createConstantSource()
    source.offset.value = LEVEL
    source.connect(ctx.destination)
    source.start()
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Keep the audio output active for the next `ms` milliseconds (replacing any
 * earlier deadline). Safe to call often; a no-op off Android.
 */
export function keepAudioOutputAwake(ms: number): void {
  if (!enabled) return
  const c = getContext()
  if (!c) return
  if (c.state !== 'running') c.resume().catch(() => {})
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    c.suspend().catch(() => {})
  }, ms)
}

/** Let the audio output go idle now (e.g. the user paused). */
export function releaseAudioOutput(): void {
  clearTimeout(releaseTimer)
  ctx?.suspend().catch(() => {})
}
