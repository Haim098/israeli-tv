import { create } from 'zustand'
import type { Channel } from '../types'
import { channels } from '../data/channels'

const LAST_CHANNEL_KEY = 'lastChannel'

// localStorage can throw (Safari private mode, disabled storage, quota). Never
// let persistence crash store init or channel switching.
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

interface TvState {
  channels: Channel[]
  currentChannel: Channel
  isLoading: boolean
  error: string | null
  /** True while the active media element (video, or the background audio swap) is playing. */
  isPlaying: boolean
  setChannel: (channel: Channel) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setPlaying: (playing: boolean) => void
  nextChannel: () => void
  prevChannel: () => void
}

export const useTvStore = create<TvState>((set, get) => ({
  channels,
  currentChannel: (() => {
    const savedId = safeGetItem(LAST_CHANNEL_KEY)
    return channels.find((c) => c.id === savedId) ?? channels[0]
  })(),
  isLoading: false,
  error: null,
  isPlaying: false,
  setChannel: (channel) => {
    // Re-selecting the playing channel must not raise the loading spinner:
    // the player doesn't reload for the same channel, so nothing would clear it.
    if (channel.id === get().currentChannel.id) return
    safeSetItem(LAST_CHANNEL_KEY, channel.id)
    set({ currentChannel: channel, isLoading: true, error: null })
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  nextChannel: () => {
    const { channels, currentChannel } = get()
    const idx = channels.findIndex((c) => c.id === currentChannel.id)
    const next = channels[(idx + 1) % channels.length]
    safeSetItem(LAST_CHANNEL_KEY, next.id)
    set({ currentChannel: next, isLoading: true, error: null })
  },
  prevChannel: () => {
    const { channels, currentChannel } = get()
    const idx = channels.findIndex((c) => c.id === currentChannel.id)
    const prev = channels[(idx - 1 + channels.length) % channels.length]
    safeSetItem(LAST_CHANNEL_KEY, prev.id)
    set({ currentChannel: prev, isLoading: true, error: null })
  },
}))
