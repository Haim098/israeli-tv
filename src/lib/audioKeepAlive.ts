/**
 * Keep the phone's audio path awake across channel switches.
 *
 * A channel switch tears down the <video> element's media pipeline, so for a
 * moment the browser plays nothing and Chrome closes its audio output stream.
 * On Android, re-opening that stream (and waking the speaker amp or a
 * Bluetooth link) takes a while, so the new channel's picture can be moving
 * before its sound comes out.
 *
 * Two independent strategies, selectable at runtime (the A/V debug overlay
 * switches between them so they can be compared on a real phone):
 *
 * - 'webaudio': while a channel loads or a stream stalls, play an inaudible
 *   signal through Web Audio. Keeps the device's output (speaker amp /
 *   Bluetooth) active.
 * - 'element': while the user is watching, loop an inaudible clip in a hidden
 *   <audio> element in the same format as the streams (48 kHz stereo). Chrome
 *   feeds media elements through a shared audio mixer, so the new channel
 *   joins an output stream that is already running instead of opening a new
 *   one.
 */

export type KeepAliveMode = 'off' | 'webaudio' | 'element' | 'both'

const MODE_KEY = 'avKeepAlive'
const DEFAULT_MODE: KeepAliveMode = 'both'

const isAndroid =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

function readMode(): KeepAliveMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'off' || v === 'webaudio' || v === 'element' || v === 'both') return v
  } catch { /* storage unavailable */ }
  return DEFAULT_MODE
}

let mode: KeepAliveMode = readMode()

export function getKeepAliveMode(): KeepAliveMode {
  return mode
}

export function setKeepAliveMode(next: KeepAliveMode): void {
  mode = next
  try { localStorage.setItem(MODE_KEY, next) } catch { /* ignore */ }
  if (!usesWebAudio()) releaseAudioOutput()
  if (!usesElement()) pauseWarmElement()
  else if (warmWanted) playWarmElement()
}

const usesWebAudio = () => isAndroid && (mode === 'webaudio' || mode === 'both')
const usesElement = () => isAndroid && (mode === 'element' || mode === 'both')

// Before the first user gesture the browser may refuse to start audio (it
// allows it straight away for an installed app the user watches often). In
// that case retry on the first tap anywhere.
let gestureRetryArmed = false
function retryOnFirstGesture(): void {
  if (gestureRetryArmed || typeof document === 'undefined') return
  gestureRetryArmed = true
  const retry = () => {
    gestureRetryArmed = false
    if (warmWanted) playWarmElement()
    if (holdingOutput && ctx?.state !== 'running') ctx?.resume().catch(() => {})
  }
  document.addEventListener('pointerdown', retry, { once: true, capture: true })
}

// --- 'webaudio' strategy ---------------------------------------------------

// Far below anything audible (-120 dBFS), but not digital zero: Chrome stops
// feeding the output device after a stretch of exact-zero samples.
const LEVEL = 1e-6

let ctx: AudioContext | null = null
let releaseTimer: ReturnType<typeof setTimeout> | undefined
let holdingOutput = false

function getContext(): AudioContext | null {
  if (ctx) return ctx
  if (!('AudioContext' in window)) return null
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
  if (!usesWebAudio()) return
  const c = getContext()
  if (!c) return
  holdingOutput = true
  if (c.state !== 'running') c.resume().catch(() => retryOnFirstGesture())
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    holdingOutput = false
    c.suspend().catch(() => {})
  }, ms)
}

/** Let the audio output go idle now (e.g. the user paused). */
export function releaseAudioOutput(): void {
  holdingOutput = false
  clearTimeout(releaseTimer)
  ctx?.suspend().catch(() => {})
}

// --- 'element' strategy ----------------------------------------------------

let warmEl: HTMLAudioElement | null = null
let warmWanted = false

/** One second of 48 kHz stereo 16-bit PCM at ±1 LSB (-90 dBFS) as a WAV. */
function makeNearSilentWav(): Blob {
  const rate = 48_000
  const channels = 2
  const frames = rate
  const dataBytes = frames * channels * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, channels, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, dataBytes, true)
  for (let i = 0; i < frames * channels; i++) v.setInt16(44 + i * 2, (i >> 1) & 1 ? 1 : -1, true)
  return new Blob([buf], { type: 'audio/wav' })
}

function getWarmElement(): HTMLAudioElement | null {
  if (warmEl) return warmEl
  if (typeof document === 'undefined') return null
  const el = document.createElement('audio')
  el.src = URL.createObjectURL(makeNearSilentWav())
  el.loop = true
  el.preload = 'auto'
  // Keep it out of the lock-screen / notification controls.
  el.setAttribute('x-webkit-airplay', 'deny')
  el.disableRemotePlayback = true
  warmEl = el
  return el
}

function playWarmElement(): void {
  if (!usesElement()) return
  const el = getWarmElement()
  if (el?.paused) el.play().catch(() => retryOnFirstGesture())
}

function pauseWarmElement(): void {
  if (warmEl && !warmEl.paused) warmEl.pause()
}

/**
 * Tell the 'element' strategy whether the user is currently watching. It has
 * to be running *before* a channel's own audio starts — including the very
 * first channel after the app opens, when the phone's audio output is still
 * cold — so it follows the whole viewing session, not just the loading gaps.
 */
export function setWatching(watching: boolean): void {
  warmWanted = watching
  if (watching) playWarmElement()
  else pauseWarmElement()
}
