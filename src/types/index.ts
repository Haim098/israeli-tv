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
  /** If set, called to resolve a fresh stream URL (e.g. token-gated streams) */
  resolveUrl?: () => Promise<string>
}
