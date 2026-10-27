import { useEffect, useRef, useState } from 'react'
import { useTvStore } from '../../stores/tvStore'
import { getKeepAliveMode, setKeepAliveMode, type KeepAliveMode } from '../../lib/audioKeepAlive'

/**
 * On-screen audio/video start timing, for diagnosing on a real phone.
 * Turn on with `?debug=1` in the URL (remembered), off with `?debug=0`.
 *
 * For each channel load, all times are ms from the channel tap:
 *   play  – the <video> fired `playing`
 *   frame – first video frame presented
 *   move  – the picture started moving (media clock running)
 *   snd   – first audible sound coming out of the <video> element
 *   Δ     – snd − move: how long the moving picture was silent
 */

interface Row {
  id: number
  ch: string
  mode: KeepAliveMode
  play?: number
  frame?: number
  move?: number
  snd?: number
  stalls: number
}

// Audible threshold for the captured stream. Speech/music sits around
// -20..-40 dBFS; the keep-alive signals are far below this.
const SOUND_DB = -55

const MODES: KeepAliveMode[] = ['off', 'webaudio', 'element', 'both']

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream }

export function AVDebug({ video }: { video: HTMLVideoElement | null }) {
  const [rows, setRows] = useState<Row[]>([])
  const [mode, setMode] = useState<KeepAliveMode>(getKeepAliveMode())
  const [latency, setLatency] = useState('')
  const cur = useRef<{ row: Row; t0: number; firstMediaTime?: number } | null>(null)

  useEffect(() => {
    if (!video) return
    const v = video as CapturableVideo
    let nextId = 1
    let ctx: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let rvfc = 0

    const now = () => performance.now()
    const update = (patch: Partial<Row>) => {
      const c = cur.current
      if (!c) return
      c.row = { ...c.row, ...patch }
      const row = c.row
      setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 7))
    }
    const mark = (key: 'play' | 'frame' | 'move' | 'snd') => {
      const c = cur.current
      if (c && c.row[key] == null) update({ [key]: Math.round(now() - c.t0) })
    }

    const startRow = () => {
      const ch = useTvStore.getState().currentChannel.name
      cur.current = { t0: now(), row: { id: nextId++, ch, mode: getKeepAliveMode(), stalls: 0 } }
      update({})
    }

    const onFrame: VideoFrameRequestCallback = (_t, meta) => {
      const c = cur.current
      if (c) {
        if (c.firstMediaTime == null) {
          c.firstMediaTime = meta.mediaTime
          mark('frame')
        } else if (meta.mediaTime > c.firstMediaTime + 0.04) {
          mark('move')
        }
      }
      rvfc = v.requestVideoFrameCallback(onFrame)
    }
    if ('requestVideoFrameCallback' in v) rvfc = v.requestVideoFrameCallback(onFrame)

    // Tap the element's own audio output (before the speaker) on every load.
    const connectCapture = () => {
      try {
        if (!v.captureStream) return
        ctx ??= new AudioContext()
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
        const base = ctx.baseLatency ? Math.round(ctx.baseLatency * 1000) : '?'
        const out = ctx.outputLatency ? Math.round(ctx.outputLatency * 1000) : '?'
        setLatency(`out ${out}ms base ${base}ms`)
        const tracks = v.captureStream().getAudioTracks().filter((t) => t.readyState === 'live')
        if (!tracks.length) return
        source?.disconnect()
        source = ctx.createMediaStreamSource(new MediaStream(tracks))
        analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
      } catch { /* capture unsupported — snd stays empty */ }
    }

    const data = new Float32Array(512)
    const poll = setInterval(() => {
      if (!analyser || !cur.current || cur.current.row.snd != null) return
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (const x of data) sum += x * x
      const db = 10 * Math.log10(sum / data.length + 1e-12)
      if (db > SOUND_DB && cur.current.row.play != null) mark('snd')
    }, 15)

    const onLoadStart = () => {
      if (!cur.current || cur.current.row.play != null) startRow()
      if (cur.current) cur.current.firstMediaTime = undefined
      analyser = null
    }
    const onPlaying = () => {
      mark('play')
      connectCapture()
    }
    const onWaiting = () => {
      const c = cur.current
      if (c?.row.play != null) update({ stalls: c.row.stalls + 1 })
    }

    // A tap starts the clock even before the element reloads (resolvers).
    const unsub = useTvStore.subscribe((s, p) => {
      if (s.currentChannel.id !== p.currentChannel.id) startRow()
    })
    startRow()

    v.addEventListener('loadstart', onLoadStart)
    v.addEventListener('playing', onPlaying)
    v.addEventListener('waiting', onWaiting)
    if (!v.paused) onPlaying()
    return () => {
      unsub()
      clearInterval(poll)
      if (rvfc) v.cancelVideoFrameCallback(rvfc)
      v.removeEventListener('loadstart', onLoadStart)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('waiting', onWaiting)
      source?.disconnect()
      ctx?.close().catch(() => {})
    }
  }, [video])

  const fmt = (n?: number) => (n == null ? '–' : String(n))

  return (
    <div
      dir="ltr"
      className="absolute left-1 top-1 z-30 max-w-[96%] rounded bg-black/75 p-1 font-mono text-[9px] leading-tight text-lime-300"
      onClick={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="mb-0.5 flex flex-wrap items-center gap-1">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => { setKeepAliveMode(m); setMode(m) }}
            className={`rounded px-1 ${m === mode ? 'bg-lime-400 text-black' : 'bg-white/15 text-white'}`}
          >
            {m}
          </button>
        ))}
        <span className="text-white/60">{latency}</span>
      </div>
      <table>
        <thead className="text-white/60">
          <tr><td className="pr-1">ch</td><td className="pr-1">mode</td><td className="pr-1">play</td><td className="pr-1">frame</td><td className="pr-1">move</td><td className="pr-1">snd</td><td className="pr-1">Δ</td><td>st</td></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gap = r.snd != null && r.move != null ? r.snd - r.move : undefined
            return (
              <tr key={r.id}>
                <td className="pr-1">{r.ch}</td>
                <td className="pr-1">{r.mode}</td>
                <td className="pr-1">{fmt(r.play)}</td>
                <td className="pr-1">{fmt(r.frame)}</td>
                <td className="pr-1">{fmt(r.move)}</td>
                <td className="pr-1">{fmt(r.snd)}</td>
                <td className={`pr-1 ${gap != null && gap > 300 ? 'text-red-400' : ''}`}>{fmt(gap)}</td>
                <td>{r.stalls}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
