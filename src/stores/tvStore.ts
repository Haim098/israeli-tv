import { create } from 'zustand'
import type { Channel } from '../types'
import { channels } from '../data/channels'

interface TvState {
  channels: Channel[]
  currentChannel: Channel
  isLoading: boolean
  error: string | null
  setChannel: (channel: Channel) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  nextChannel: () => void
  prevChannel: () => void
}

export const useTvStore = create<TvState>((set, get) => ({
  channels,
  currentChannel: (() => {
    const savedId = localStorage.getItem('lastChannel')
    return channels.find((c) => c.id === savedId) ?? channels[0]
  })(),
  isLoading: false,
  error: null,
  setChannel: (channel) => {
    localStorage.setItem('lastChannel', channel.id)
    set({ currentChannel: channel, isLoading: true, error: null })
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  nextChannel: () => {
    const { channels, currentChannel } = get()
    const idx = channels.findIndex((c) => c.id === currentChannel.id)
    const next = channels[(idx + 1) % channels.length]
    localStorage.setItem('lastChannel', next.id)
    set({ currentChannel: next, isLoading: true, error: null })
  },
  prevChannel: () => {
    const { channels, currentChannel } = get()
    const idx = channels.findIndex((c) => c.id === currentChannel.id)
    const prev = channels[(idx - 1 + channels.length) % channels.length]
    localStorage.setItem('lastChannel', prev.id)
    set({ currentChannel: prev, isLoading: true, error: null })
  },
}))
