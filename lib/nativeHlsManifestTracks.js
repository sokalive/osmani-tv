/**
 * Read HLS master-playlist variants and audio renditions for native Exo UI.
 * expo-av does not expose ExoPlayer track lists — this parses the master manifest sidecar.
 */

import { resolveStreamProxyBase } from './mediaDelivery';

/** @param {unknown} input */
function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

/**
 * @param {string} streamUrl
 * @param {{ referer?: string, origin?: string, userAgent?: string }} [headers]
 */
function buildTrackProxyUrl(streamUrl, headers = {}) {
  const u = String(streamUrl ?? '').trim();
  if (!u) return '';
  if (isStreamProxyUrl(u)) return u;
  const params = new URLSearchParams();
  params.set('url', u);
  if (headers.referer) params.set('referer', String(headers.referer));
  if (headers.origin) params.set('origin', String(headers.origin));
  if (headers.userAgent) params.set('ua', String(headers.userAgent));
  return `${resolveStreamProxyBase()}?${params.toString()}`;
}

/** @param {...unknown} args */
function logNativeTracks(...args) {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  try {
    console.log(...args);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} lineUrl
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveManifestUrl(lineUrl, baseUrl) {
  const raw = String(lineUrl ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

/**
 * @param {string} line
 * @param {string} key
 * @returns {string}
 */
function readTagAttr(line, key) {
  const m = new RegExp(`${key}="([^"]*)"`, 'i').exec(String(line ?? ''));
  return m ? m[1] : '';
}

/**
 * @param {unknown} line
 * @returns {number | null}
 */
function readBandwidth(line) {
  const m = /BANDWIDTH=(\d+)/i.exec(String(line ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * @param {unknown} line
 * @returns {number | null}
 */
function readHeight(line) {
  const m = /RESOLUTION=\d+x(\d+)/i.exec(String(line ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * @param {{ height?: number | null; bandwidth?: number | null; name?: string }} v
 * @returns {string}
 */
function variantLabel(v) {
  if (v.height) return `${v.height}p`;
  if (v.bandwidth) return `${Math.round(v.bandwidth / 1000)} kbps`;
  if (v.name) return String(v.name);
  return 'Stream';
}

/**
 * @param {string} manifestText
 * @param {string} manifestBaseUrl
 * @returns {{ variants: Array<{ id: number; label: string; height: number | null; bandwidth: number | null; uri: string }>; audioTracks: Array<{ id: number; label: string; lang: string; uri: string }>; isMaster: boolean }}
 */
export function parseHlsManifestTracks(manifestText, manifestBaseUrl) {
  const base = String(manifestBaseUrl ?? '').trim();
  const lines = String(manifestText ?? '').split(/\r?\n/);
  const variants = [];
  const audioTracks = [];
  let isMaster = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true;
      const height = readHeight(line);
      const bandwidth = readBandwidth(line);
      const name = readTagAttr(line, 'NAME');
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (!next) {
          j += 1;
          continue;
        }
        if (next.startsWith('#')) break;
        const uri = resolveManifestUrl(next, base);
        if (uri) {
          variants.push({
            id: variants.length,
            height,
            bandwidth,
            name,
            label: variantLabel({ height, bandwidth, name }),
            uri,
          });
        }
        break;
      }
      continue;
    }

    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/i.test(line)) {
      isMaster = true;
      const name = readTagAttr(line, 'NAME');
      const lang = readTagAttr(line, 'LANGUAGE');
      const uriRaw = readTagAttr(line, 'URI');
      const isDefault = /DEFAULT=YES/i.test(line);
      const langUpper = lang ? lang.toUpperCase() : '';
      const label = langUpper || (name ? String(name).toUpperCase() : '') || `Audio ${audioTracks.length + 1}`;
      audioTracks.push({
        id: audioTracks.length,
        label,
        lang,
        uri: uriRaw ? resolveManifestUrl(uriRaw, base) : '',
        default: isDefault,
      });
    }
  }

  /** Dedupe variants by height (keep highest bandwidth per height). */
  const byHeight = new Map();
  for (const v of variants) {
    const key = v.height ?? v.bandwidth ?? v.uri;
    const prev = byHeight.get(key);
    if (!prev || (v.bandwidth ?? 0) > (prev.bandwidth ?? 0)) {
      byHeight.set(key, v);
    }
  }
  const deduped = [...byHeight.values()].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  deduped.forEach((v, index) => {
    v.id = index;
  });

  return { variants: deduped, audioTracks, isMaster };
}

/**
 * @param {string} manifestUrl
 * @param {Record<string, string>} [headers]
 * @returns {Promise<ReturnType<typeof parseHlsManifestTracks>>}
 */
/**
 * @param {string} uri
 * @returns {string}
 */
function extractProxiedUpstreamUrl(uri) {
  if (!isStreamProxyUrl(uri)) return '';
  try {
    return String(new URL(String(uri)).searchParams.get('url') ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Candidate master URLs for native track discovery (proxy + upstream + alternates).
 * @param {string} manifestUrl
 * @param {string} rawUri
 * @param {Record<string, string>} [headers]
 * @returns {string[]}
 */
export function resolveNativeTrackManifestUrls(manifestUrl, rawUri, headers = {}) {
  /** @type {string[]} */
  const urls = [];
  const push = (value) => {
    const s = String(value ?? '').trim();
    if (s && !urls.includes(s)) urls.push(s);
  };
  const headerBag = {
    referer: headers.Referer ?? '',
    origin: headers.Origin ?? '',
    userAgent: headers['User-Agent'] ?? '',
  };

  push(manifestUrl);
  push(rawUri);

  const upstream =
    extractProxiedUpstreamUrl(manifestUrl) ||
    extractProxiedUpstreamUrl(rawUri) ||
    (looksLikeHttpUrl(rawUri) && !isStreamProxyUrl(rawUri) ? rawUri : '');

  if (upstream) {
    push(upstream);
    push(buildTrackProxyUrl(upstream, headerBag));
    try {
      const u = new URL(upstream);
      const dir = u.pathname.replace(/\/[^/]*$/, '/');
      for (const name of ['master.m3u8', 'playlist.m3u8', 'manifest.m3u8', 'index.m3u8']) {
        const alt = new URL(`${dir}${name}`, u.origin);
        alt.search = u.search;
        push(alt.toString());
        push(buildTrackProxyUrl(alt.toString(), headerBag));
      }
    } catch {
      /* ignore bad upstream URL */
    }
  }

  return urls;
}

/** @param {unknown} value */
function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ''));
}

/**
 * @param {ReturnType<typeof parseHlsManifestTracks>} a
 * @param {ReturnType<typeof parseHlsManifestTracks>} b
 * @returns {boolean}
 */
function parsedTracksRicher(a, b) {
  const aScore = a.variants.length * 10 + a.audioTracks.length;
  const bScore = b.variants.length * 10 + b.audioTracks.length;
  return aScore > bScore;
}

/**
 * Try several manifest URLs and return the richest master parse (variants + audio).
 * @param {string} manifestUrl
 * @param {string} rawUri
 * @param {Record<string, string>} [headers]
 * @returns {Promise<ReturnType<typeof parseHlsManifestTracks>>}
 */
export async function fetchNativeHlsManifestTracksForPlayback(manifestUrl, rawUri, headers = {}) {
  const candidates = resolveNativeTrackManifestUrls(manifestUrl, rawUri, headers);
  /** @type {ReturnType<typeof parseHlsManifestTracks>} */
  let best = { variants: [], audioTracks: [], isMaster: false };

  for (const candidate of candidates) {
    const parsed = await fetchNativeHlsManifestTracks(candidate, headers);
    if (parsed.variants.length && parsed.audioTracks.length) {
      logNativeTracks('[native-hls-tracks] resolved', {
        url: candidate.slice(0, 96),
        variants: parsed.variants.length,
        audioTracks: parsed.audioTracks.length,
      });
      return parsed;
    }
    if (parsedTracksRicher(parsed, best)) {
      best = parsed;
    }
  }

  logNativeTracks('[native-hls-tracks] resolved_best', {
    variants: best.variants.length,
    audioTracks: best.audioTracks.length,
    isMaster: best.isMaster,
  });
  return best;
}

export async function fetchNativeHlsManifestTracks(manifestUrl, headers = {}) {
  const url = String(manifestUrl ?? '').trim();
  if (!url) {
    return { variants: [], audioTracks: [], isMaster: false };
  }

  const h = {};
  if (headers.Referer) h.Referer = headers.Referer;
  if (headers.Origin) h.Origin = headers.Origin;
  if (headers['User-Agent']) h['User-Agent'] = headers['User-Agent'];

  try {
    const res = await fetch(url, { headers: h });
    if (!res.ok) {
      logNativeTracks('[native-hls-tracks] manifest_fetch_failed', { status: res.status, url: url.slice(0, 96) });
      return { variants: [], audioTracks: [], isMaster: false };
    }
    const text = await res.text();
    const parsed = parseHlsManifestTracks(text, url);
    logNativeTracks('[native-hls-tracks] parsed', {
      variants: parsed.variants.length,
      audioTracks: parsed.audioTracks.length,
      isMaster: parsed.isMaster,
    });
    return parsed;
  } catch (e) {
    logNativeTracks('[native-hls-tracks] manifest_fetch_error', e?.message ?? e);
    return { variants: [], audioTracks: [], isMaster: false };
  }
}
