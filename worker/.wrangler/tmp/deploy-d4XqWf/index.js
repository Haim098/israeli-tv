var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var PLAYLIST_KEY = "LTf7r/zM2VndHwP+4So6bw==";
var TOKEN_KEY = "YhnUaXMmltB6gd8p9SWleQ==";
var IV = "theExact16Chars=";
var VCM_ID = "6540b8dcb64fd310VgnVCM2000002a0c10acRCRD";
var VIDEO_CHANNEL_ID = "5d28d21b4580e310VgnVCM2000002a0c10acRCRD";
var APP_VERSION = "7.4.0";
var SBOX = new Uint8Array([
  99,
  124,
  119,
  123,
  242,
  107,
  111,
  197,
  48,
  1,
  103,
  43,
  254,
  215,
  171,
  118,
  202,
  130,
  201,
  125,
  250,
  89,
  71,
  240,
  173,
  212,
  162,
  175,
  156,
  164,
  114,
  192,
  183,
  253,
  147,
  38,
  54,
  63,
  247,
  204,
  52,
  165,
  229,
  241,
  113,
  216,
  49,
  21,
  4,
  199,
  35,
  195,
  24,
  150,
  5,
  154,
  7,
  18,
  128,
  226,
  235,
  39,
  178,
  117,
  9,
  131,
  44,
  26,
  27,
  110,
  90,
  160,
  82,
  59,
  214,
  179,
  41,
  227,
  47,
  132,
  83,
  209,
  0,
  237,
  32,
  252,
  177,
  91,
  106,
  203,
  190,
  57,
  74,
  76,
  88,
  207,
  208,
  239,
  170,
  251,
  67,
  77,
  51,
  133,
  69,
  249,
  2,
  127,
  80,
  60,
  159,
  168,
  81,
  163,
  64,
  143,
  146,
  157,
  56,
  245,
  188,
  182,
  218,
  33,
  16,
  255,
  243,
  210,
  205,
  12,
  19,
  236,
  95,
  151,
  68,
  23,
  196,
  167,
  126,
  61,
  100,
  93,
  25,
  115,
  96,
  129,
  79,
  220,
  34,
  42,
  144,
  136,
  70,
  238,
  184,
  20,
  222,
  94,
  11,
  219,
  224,
  50,
  58,
  10,
  73,
  6,
  36,
  92,
  194,
  211,
  172,
  98,
  145,
  149,
  228,
  121,
  231,
  200,
  55,
  109,
  141,
  213,
  78,
  169,
  108,
  86,
  244,
  234,
  101,
  122,
  174,
  8,
  186,
  120,
  37,
  46,
  28,
  166,
  180,
  198,
  232,
  221,
  116,
  31,
  75,
  189,
  139,
  138,
  112,
  62,
  181,
  102,
  72,
  3,
  246,
  14,
  97,
  53,
  87,
  185,
  134,
  193,
  29,
  158,
  225,
  248,
  152,
  17,
  105,
  217,
  142,
  148,
  155,
  30,
  135,
  233,
  206,
  85,
  40,
  223,
  140,
  161,
  137,
  13,
  191,
  230,
  66,
  104,
  65,
  153,
  45,
  15,
  176,
  84,
  187,
  22
]);
var INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216];
function subWord(w) {
  return (SBOX[w >>> 24 & 255] << 24 | SBOX[w >>> 16 & 255] << 16 | SBOX[w >>> 8 & 255] << 8 | SBOX[w & 255]) >>> 0;
}
__name(subWord, "subWord");
function rotWord(w) {
  return (w << 8 | w >>> 24) >>> 0;
}
__name(rotWord, "rotWord");
function expandKey192(key) {
  const Nk = 6, Nr = 12, Nb = 4;
  const W = new Uint32Array(Nb * (Nr + 1));
  for (let i = 0; i < Nk; i++) {
    W[i] = key[4 * i] << 24 | key[4 * i + 1] << 16 | key[4 * i + 2] << 8 | key[4 * i + 3];
  }
  for (let i = Nk; i < Nb * (Nr + 1); i++) {
    let t = W[i - 1];
    if (i % Nk === 0) {
      t = (subWord(rotWord(t)) ^ RCON[i / Nk - 1] << 24) >>> 0;
    }
    W[i] = (W[i - Nk] ^ t) >>> 0;
  }
  return W;
}
__name(expandKey192, "expandKey192");
function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 128;
    a = a << 1 & 255;
    if (hi) a ^= 27;
    b >>= 1;
  }
  return p;
}
__name(gmul, "gmul");
function aesBlock(block, W, Nr) {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = block[i];
  for (let i = 0; i < 4; i++) {
    const w = W[i];
    s[4 * i] ^= w >>> 24 & 255;
    s[4 * i + 1] ^= w >>> 16 & 255;
    s[4 * i + 2] ^= w >>> 8 & 255;
    s[4 * i + 3] ^= w & 255;
  }
  for (let r = 1; r <= Nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    let t = s[1];
    s[1] = s[5];
    s[5] = s[9];
    s[9] = s[13];
    s[13] = t;
    t = s[2];
    s[2] = s[10];
    s[10] = t;
    t = s[6];
    s[6] = s[14];
    s[14] = t;
    t = s[15];
    s[15] = s[11];
    s[11] = s[7];
    s[7] = s[3];
    s[3] = t;
    if (r < Nr) {
      for (let c = 0; c < 4; c++) {
        const i = 4 * c;
        const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        s[i] = gmul(2, a0) ^ gmul(3, a1) ^ a2 ^ a3;
        s[i + 1] = a0 ^ gmul(2, a1) ^ gmul(3, a2) ^ a3;
        s[i + 2] = a0 ^ a1 ^ gmul(2, a2) ^ gmul(3, a3);
        s[i + 3] = gmul(3, a0) ^ a1 ^ a2 ^ gmul(2, a3);
      }
    }
    for (let i = 0; i < 4; i++) {
      const w = W[r * 4 + i];
      s[4 * i] ^= w >>> 24 & 255;
      s[4 * i + 1] ^= w >>> 16 & 255;
      s[4 * i + 2] ^= w >>> 8 & 255;
      s[4 * i + 3] ^= w & 255;
    }
  }
  return s;
}
__name(aesBlock, "aesBlock");
function aesInvBlock(block, W, Nr) {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = block[i];
  for (let i = 0; i < 4; i++) {
    const w = W[Nr * 4 + i];
    s[4 * i] ^= w >>> 24 & 255;
    s[4 * i + 1] ^= w >>> 16 & 255;
    s[4 * i + 2] ^= w >>> 8 & 255;
    s[4 * i + 3] ^= w & 255;
  }
  for (let r = Nr - 1; r >= 0; r--) {
    let t = s[13];
    s[13] = s[9];
    s[9] = s[5];
    s[5] = s[1];
    s[1] = t;
    t = s[10];
    s[10] = s[2];
    s[2] = t;
    t = s[14];
    s[14] = s[6];
    s[6] = t;
    t = s[3];
    s[3] = s[7];
    s[7] = s[11];
    s[11] = s[15];
    s[15] = t;
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (let i = 0; i < 4; i++) {
      const w = W[r * 4 + i];
      s[4 * i] ^= w >>> 24 & 255;
      s[4 * i + 1] ^= w >>> 16 & 255;
      s[4 * i + 2] ^= w >>> 8 & 255;
      s[4 * i + 3] ^= w & 255;
    }
    if (r > 0) {
      for (let c = 0; c < 4; c++) {
        const i = 4 * c;
        const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        s[i] = gmul(14, a0) ^ gmul(11, a1) ^ gmul(13, a2) ^ gmul(9, a3);
        s[i + 1] = gmul(9, a0) ^ gmul(14, a1) ^ gmul(11, a2) ^ gmul(13, a3);
        s[i + 2] = gmul(13, a0) ^ gmul(9, a1) ^ gmul(14, a2) ^ gmul(11, a3);
        s[i + 3] = gmul(11, a0) ^ gmul(13, a1) ^ gmul(9, a2) ^ gmul(14, a3);
      }
    }
  }
  return s;
}
__name(aesInvBlock, "aesInvBlock");
function aes192CbcDecrypt(data, keyBytes, ivBytes) {
  const W = expandKey192(keyBytes);
  const blocks = [];
  let prev = ivBytes;
  for (let i = 0; i < data.length; i += 16) {
    const block = data.slice(i, i + 16);
    const dec = aesInvBlock(block, W, 12);
    const plain = new Uint8Array(16);
    for (let j = 0; j < 16; j++) plain[j] = dec[j] ^ prev[j];
    blocks.push(plain);
    prev = block;
  }
  const all = new Uint8Array(blocks.length * 16);
  blocks.forEach((b, i) => all.set(b, i * 16));
  const padLen = all[all.length - 1];
  return all.slice(0, all.length - padLen);
}
__name(aes192CbcDecrypt, "aes192CbcDecrypt");
function aes192CbcEncrypt(data, keyBytes, ivBytes) {
  const padLen = 16 - data.length % 16;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen;
  const W = expandKey192(keyBytes);
  const result = new Uint8Array(padded.length);
  let prev = ivBytes;
  for (let i = 0; i < padded.length; i += 16) {
    const block = new Uint8Array(16);
    for (let j = 0; j < 16; j++) block[j] = padded[i + j] ^ prev[j];
    const enc = aesBlock(block, W, 12);
    result.set(enc, i);
    prev = enc;
  }
  return result;
}
__name(aes192CbcEncrypt, "aes192CbcEncrypt");
function strToBytes(s) {
  return new TextEncoder().encode(s);
}
__name(strToBytes, "strToBytes");
function bytesToStr(b) {
  return new TextDecoder().decode(b);
}
__name(bytesToStr, "bytesToStr");
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
__name(b64ToBytes, "b64ToBytes");
function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
__name(bytesToB64, "bytesToB64");
function decryptPayload(b64Data, keyStr) {
  const data = b64ToBytes(b64Data);
  const keyBytes = strToBytes(keyStr);
  const ivBytes = strToBytes(IV);
  return bytesToStr(aes192CbcDecrypt(data, keyBytes, ivBytes));
}
__name(decryptPayload, "decryptPayload");
function encryptPayload(jsonStr, keyStr) {
  const data = strToBytes(jsonStr);
  const keyBytes = strToBytes(keyStr);
  const ivBytes = strToBytes(IV);
  return bytesToB64(aes192CbcEncrypt(data, keyBytes, ivBytes));
}
__name(encryptPayload, "encryptPayload");
async function getKeshet12StreamUrl() {
  const playlistResp = await fetch(
    `https://www.mako.co.il/AjaxPage?jspName=playlist12.jsp&vcmid=${VCM_ID}&videoChannelId=${VIDEO_CHANNEL_ID}&galleryChannelId=${VCM_ID}&consumer=responsive`
  );
  const playlistEncrypted = (await playlistResp.text()).trim();
  const playlist = JSON.parse(decryptPayload(playlistEncrypted, PLAYLIST_KEY));
  const streamUrl = playlist.media[0].url;
  const streamPath = streamUrl.replace(/^.*\/\/[^/]+/, "");
  const deviceId = crypto.randomUUID();
  const payload = JSON.stringify({
    lp: streamPath,
    rv: "AKAMAI",
    du: deviceId,
    dv: VCM_ID,
    na: APP_VERSION
  });
  const encPayload = encryptPayload(payload, TOKEN_KEY);
  const tokenResp = await fetch(
    "https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=egt",
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://www.mako.co.il",
        "Referer": "https://www.mako.co.il/"
      },
      body: encPayload
    }
  );
  const tokenEncrypted = (await tokenResp.text()).trim();
  const tokenData = JSON.parse(decryptPayload(tokenEncrypted, TOKEN_KEY));
  if (!tokenData.tickets || tokenData.tickets.length === 0) {
    throw new Error("No tickets returned: " + JSON.stringify(tokenData));
  }
  const ticket = decodeURIComponent(tokenData.tickets[0].ticket);
  return streamUrl + "&" + ticket;
}
__name(getKeshet12StreamUrl, "getKeshet12StreamUrl");
var index_default = {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/api/keshet12") {
      try {
        const streamUrl = await getKeshet12StreamUrl();
        return new Response(JSON.stringify({ url: streamUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "max-age=300" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    if (url.pathname === "/api/debug") {
      const steps = {};
      try {
        const geoResp = await fetch("https://mass.mako.co.il/ClicksStatistics/isAbroad.jsp", {
          headers: { "User-Agent": "Mozilla/5.0", "Origin": "https://www.mako.co.il", "Referer": "https://www.mako.co.il/" }
        });
        steps.isAbroad = (await geoResp.text()).trim();
        const playlistResp = await fetch(
          `https://www.mako.co.il/AjaxPage?jspName=playlist12.jsp&vcmid=${VCM_ID}&videoChannelId=${VIDEO_CHANNEL_ID}&galleryChannelId=${VCM_ID}&consumer=responsive`
        );
        const playlistEnc = (await playlistResp.text()).trim();
        const playlist = JSON.parse(decryptPayload(playlistEnc, PLAYLIST_KEY));
        steps.streamUrl = playlist.media[0].url;
        steps.playlistOk = true;
        const streamPath = steps.streamUrl.replace(/^.*\/\/[^/]+/, "");
        const deviceId = crypto.randomUUID();
        const payload = JSON.stringify({ lp: streamPath, rv: "AKAMAI", du: deviceId, dv: VCM_ID, na: APP_VERSION });
        steps.payload = payload;
        const encPayload = encryptPayload(payload, TOKEN_KEY);
        const tokenResp = await fetch("https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=egt", {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8", "User-Agent": "Mozilla/5.0", "Origin": "https://www.mako.co.il", "Referer": "https://www.mako.co.il/" },
          body: encPayload
        });
        const tokenEnc = (await tokenResp.text()).trim();
        steps.tokenRaw = tokenEnc.substring(0, 100);
        if (tokenEnc.startsWith("<")) {
          steps.tokenError = "Got HTML (bot protection)";
        } else {
          const tokenData = JSON.parse(decryptPayload(tokenEnc, TOKEN_KEY));
          steps.tokenData = tokenData;
        }
        steps.cfColo = request.cf?.colo;
        steps.cfCountry = request.cf?.country;
      } catch (e) {
        steps.error = e.message;
      }
      return new Response(JSON.stringify(steps, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/api/keshet12/stream") {
      try {
        const streamUrl = await getKeshet12StreamUrl();
        const resp = await fetch(streamUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        const manifest = await resp.text();
        return new Response(manifest, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-cache"
          }
        });
      } catch (e) {
        return new Response("# Stream error: " + e.message, {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/vnd.apple.mpegurl" }
        });
      }
    }
    return new Response("Israeli TV Stream Proxy\n\nEndpoints:\n  GET /api/keshet12 - Get fresh stream URL\n  GET /api/keshet12/stream - Proxied HLS manifest", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
