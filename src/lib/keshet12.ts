/**
 * Keshet 12 stream URL resolver
 *
 * Fetches the live stream URL by:
 * 1. Calling playlist12.jsp and decrypting the AES-encrypted response
 * 2. Calling the entitlements API with an encrypted request
 * 3. Decrypting the response to get an hdnea token
 * 4. Combining the base stream URL with the token
 */

// --- AES-192-CBC implementation (Web Crypto doesn't support AES-192) ---

const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
])

const INV_SBOX = new Uint8Array(256)
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8]

function subWord(w: number) {
  return ((SBOX[(w>>>24)&0xff]<<24) | (SBOX[(w>>>16)&0xff]<<16) | (SBOX[(w>>>8)&0xff]<<8) | SBOX[w&0xff]) >>> 0
}
function rotWord(w: number) { return ((w << 8) | (w >>> 24)) >>> 0 }

function expandKey192(key: Uint8Array) {
  const Nk = 6, Nr = 12, Nb = 4
  const W = new Uint32Array(Nb * (Nr + 1))
  for (let i = 0; i < Nk; i++) W[i] = (key[4*i]<<24) | (key[4*i+1]<<16) | (key[4*i+2]<<8) | key[4*i+3]
  for (let i = Nk; i < Nb*(Nr+1); i++) {
    let t = W[i-1]
    if (i % Nk === 0) t = (subWord(rotWord(t)) ^ (RCON[i/Nk - 1] << 24)) >>> 0
    W[i] = (W[i-Nk] ^ t) >>> 0
  }
  return W
}

function gmul(a: number, b: number) {
  let p = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a
    const hi = a & 0x80
    a = (a << 1) & 0xff
    if (hi) a ^= 0x1b
    b >>= 1
  }
  return p
}

function aesBlock(block: Uint8Array, W: Uint32Array, Nr: number) {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = block[i]
  for (let i = 0; i < 4; i++) { const w = W[i]; s[4*i] ^= (w>>>24)&0xff; s[4*i+1] ^= (w>>>16)&0xff; s[4*i+2] ^= (w>>>8)&0xff; s[4*i+3] ^= w&0xff }
  for (let r = 1; r <= Nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
    let t = s[1]; s[1]=s[5]; s[5]=s[9]; s[9]=s[13]; s[13]=t; t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t; t=s[15]; s[15]=s[11]; s[11]=s[7]; s[7]=s[3]; s[3]=t
    if (r < Nr) { for (let c = 0; c < 4; c++) { const i = 4*c; const a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3]; s[i]=gmul(2,a0)^gmul(3,a1)^a2^a3; s[i+1]=a0^gmul(2,a1)^gmul(3,a2)^a3; s[i+2]=a0^a1^gmul(2,a2)^gmul(3,a3); s[i+3]=gmul(3,a0)^a1^a2^gmul(2,a3) } }
    for (let i = 0; i < 4; i++) { const w = W[r*4+i]; s[4*i] ^= (w>>>24)&0xff; s[4*i+1] ^= (w>>>16)&0xff; s[4*i+2] ^= (w>>>8)&0xff; s[4*i+3] ^= w&0xff }
  }
  return s
}

function aesInvBlock(block: Uint8Array, W: Uint32Array, Nr: number) {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = block[i]
  for (let i = 0; i < 4; i++) { const w = W[Nr*4+i]; s[4*i] ^= (w>>>24)&0xff; s[4*i+1] ^= (w>>>16)&0xff; s[4*i+2] ^= (w>>>8)&0xff; s[4*i+3] ^= w&0xff }
  for (let r = Nr-1; r >= 0; r--) {
    let t = s[13]; s[13]=s[9]; s[9]=s[5]; s[5]=s[1]; s[1]=t; t=s[10]; s[10]=s[2]; s[2]=t; t=s[14]; s[14]=s[6]; s[6]=t; t=s[3]; s[3]=s[7]; s[7]=s[11]; s[11]=s[15]; s[15]=t
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
    for (let i = 0; i < 4; i++) { const w = W[r*4+i]; s[4*i] ^= (w>>>24)&0xff; s[4*i+1] ^= (w>>>16)&0xff; s[4*i+2] ^= (w>>>8)&0xff; s[4*i+3] ^= w&0xff }
    if (r > 0) { for (let c = 0; c < 4; c++) { const i = 4*c; const a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3]; s[i]=gmul(14,a0)^gmul(11,a1)^gmul(13,a2)^gmul(9,a3); s[i+1]=gmul(9,a0)^gmul(14,a1)^gmul(11,a2)^gmul(13,a3); s[i+2]=gmul(13,a0)^gmul(9,a1)^gmul(14,a2)^gmul(11,a3); s[i+3]=gmul(11,a0)^gmul(13,a1)^gmul(9,a2)^gmul(14,a3) } }
  }
  return s
}

function aes192CbcDecrypt(data: Uint8Array, keyBytes: Uint8Array, ivBytes: Uint8Array) {
  const W = expandKey192(keyBytes)
  const blocks: Uint8Array[] = []
  let prev = ivBytes
  for (let i = 0; i < data.length; i += 16) {
    const block = data.slice(i, i + 16)
    const dec = aesInvBlock(block, W, 12)
    const plain = new Uint8Array(16)
    for (let j = 0; j < 16; j++) plain[j] = dec[j] ^ prev[j]
    blocks.push(plain)
    prev = block
  }
  const all = new Uint8Array(blocks.length * 16)
  blocks.forEach((b, i) => all.set(b, i * 16))
  const padLen = all[all.length - 1]
  return all.slice(0, all.length - padLen)
}

function aes192CbcEncrypt(data: Uint8Array, keyBytes: Uint8Array, ivBytes: Uint8Array) {
  const padLen = 16 - (data.length % 16)
  const padded = new Uint8Array(data.length + padLen)
  padded.set(data)
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen
  const W = expandKey192(keyBytes)
  const result = new Uint8Array(padded.length)
  let prev = ivBytes
  for (let i = 0; i < padded.length; i += 16) {
    const block = new Uint8Array(16)
    for (let j = 0; j < 16; j++) block[j] = padded[i + j] ^ prev[j]
    const enc = aesBlock(block, W, 12)
    result.set(enc, i)
    prev = enc
  }
  return result
}

// --- Helpers ---

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
const bytesToB64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }

const PLAYLIST_KEY = 'LTf7r/zM2VndHwP+4So6bw=='
const TOKEN_KEY = 'YhnUaXMmltB6gd8p9SWleQ=='
const IV = 'theExact16Chars='
const VCM_ID = '6540b8dcb64fd310VgnVCM2000002a0c10acRCRD'
const VIDEO_CHANNEL_ID = '5d28d21b4580e310VgnVCM2000002a0c10acRCRD'

function decrypt(b64Data: string, keyStr: string): string {
  return decoder.decode(aes192CbcDecrypt(b64ToBytes(b64Data), encoder.encode(keyStr), encoder.encode(IV)))
}

function encrypt(jsonStr: string, keyStr: string): string {
  return bytesToB64(aes192CbcEncrypt(encoder.encode(jsonStr), encoder.encode(keyStr), encoder.encode(IV)))
}

// --- Public API ---

interface Keshet12Result {
  url: string
  expiresAt: number
}

let cached: Keshet12Result | null = null

export async function getKeshet12Url(): Promise<string> {
  // Return cached URL if still valid (with 60s buffer)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.url
  }

  // Step 1: Fetch and decrypt playlist
  const playlistResp = await fetch(
    `https://www.mako.co.il/AjaxPage?jspName=playlist12.jsp&vcmid=${VCM_ID}&videoChannelId=${VIDEO_CHANNEL_ID}&galleryChannelId=${VCM_ID}&consumer=responsive`
  )
  const playlistEncrypted = (await playlistResp.text()).trim()
  const playlist = JSON.parse(decrypt(playlistEncrypted, PLAYLIST_KEY))
  const streamUrl: string = playlist.media[0].url

  // Step 2: Request entitlements token
  const streamPath = streamUrl.replace(/^.*\/\/[^/]+/, '')
  const deviceId = crypto.randomUUID()
  const payload = JSON.stringify({
    lp: streamPath,
    rv: 'AKAMAI',
    du: deviceId,
    dv: VCM_ID,
    na: '7.4.0',
  })

  const tokenResp = await fetch(
    'https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=egt',
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: encrypt(payload, TOKEN_KEY),
    }
  )

  const tokenEncrypted = (await tokenResp.text()).trim()
  const tokenData = JSON.parse(decrypt(tokenEncrypted, TOKEN_KEY))

  if (!tokenData.tickets?.length) {
    throw new Error('No stream tickets available')
  }

  const ticket = decodeURIComponent(tokenData.tickets[0].ticket)
  const fullUrl = streamUrl + '&' + ticket

  // Parse expiry from hdnea token (exp=timestamp)
  const expMatch = ticket.match(/exp=(\d+)/)
  const expiresAt = expMatch ? parseInt(expMatch[1]) * 1000 : Date.now() + 10 * 60_000

  cached = { url: fullUrl, expiresAt }
  return fullUrl
}
