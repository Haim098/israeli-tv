export type ChannelType = 'hls' | 'iframe'

export interface Channel {
  id: string
  name: string
  number: number
  streamUrl: string
  fallbackUrl?: string
  type: ChannelType
  logo: string
  color: string
  /**
   * If set, called to resolve a fresh stream URL (e.g. token-gated streams).
   * Pass `force` to bypass the resolver's internal cache (used when an in-use
   * token was rejected mid-playback).
   */
  resolveUrl?: (force?: boolean) => Promise<string>
}
