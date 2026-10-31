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
  /**
   * How many segments behind the live edge to play (the safety margin
   * against network hiccups). Default 3. Set lower for channels with long
   * segments, so every channel ends up roughly 12s+ behind live.
   */
  liveEdgeSegments?: number
}
