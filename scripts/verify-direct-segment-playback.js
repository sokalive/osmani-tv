/**
 * Verify direct Bunny HLS segment URL resolution against live API + app logic mirror.
 * Run: node scripts/verify-direct-segment-playback.js
 */

const API_BASE = process.env.API_URL || 'https://osmani-admin-api.onrender.com';
const CDN_HOST = 'osmanitv.b-cdn.net';
const BUNNY_SEG_RE = /^https:\/\/osmanitv\.b-cdn\.net\/hls\/seg\?tok=/i;

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

function normalizeMode(raw) {
  const m = String(raw ?? '').trim().toLowerCase();
  if (m === 'direct') return 'direct';
  if (m === 'auto' || m === 'hybrid') return 'auto';
  return 'proxy';
}

function unwrapProxy(url) {
  const s = String(url ?? '').trim();
  if (!isStreamProxyUrl(s)) return s;
  try {
    const inner = new URL(s).searchParams.get('url');
    if (inner) return decodeURIComponent(inner);
  } catch {
    /* ignore */
  }
  return s;
}

function rewriteM3u8(text, base) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_, u) => {
          let abs = u;
          if (!/^https?:\/\//i.test(u)) {
            try {
              abs = new URL(u, base).toString();
            } catch {
              abs = u;
            }
          }
          return `URI="${unwrapProxy(abs)}"`;
        });
      }
      let abs = t;
      if (!/^https?:\/\//i.test(t)) {
        try {
          abs = new URL(t, base).toString();
        } catch {
          abs = t;
        }
      }
      return unwrapProxy(abs);
    })
    .join('\n');
}

function urlsFromM3u8(text, base) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const uri = t.match(/URI="([^"]+)"/i);
    if (uri) out.push(uri[1]);
    else if (!t.startsWith('#')) out.push(t);
  }
  return out.map((u) => {
    try {
      return /^https?:\/\//i.test(u) ? u : new URL(u, base).toString();
    } catch {
      return u;
    }
  });
}

function classify(url) {
  const s = String(url ?? '');
  if (!s) return 'empty';
  if (isStreamProxyUrl(s)) return 'stream_proxy';
  if (BUNNY_SEG_RE.test(s)) return 'bunny_signed_seg';
  if (s.includes(CDN_HOST) && /\/hls\//i.test(s)) return 'bunny_hls';
  if (s.includes('onrender.com')) return 'render_host';
  if (/\.(ts|m4s)(\?|$)/i.test(s.split(/[?#]/)[0])) return 'segment_other';
  if (/\.m3u8/i.test(s)) return 'variant_manifest';
  return 'other';
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function main() {
  console.log('=== Direct segment playback verification ===\n');
  console.log('API:', API_BASE);
  console.log('Expected segment pattern: https://osmanitv.b-cdn.net/hls/seg?tok=\n');

  // --- 1. Unit: app unwrap + rewrite (mirrors lib/hlsDirectSegments.js) ---
  const proxyLine =
    `https://${CDN_HOST}/stream-proxy?url=` +
    encodeURIComponent('https://osmanitv.b-cdn.net/hls/seg?tok=abc&n=1');
  const unwrapped = unwrapProxy(proxyLine);
  const unitOk = BUNNY_SEG_RE.test(unwrapped) && !isStreamProxyUrl(unwrapped);
  console.log('1) Unwrap logic (hls.js loader + Exo rewrite mirror)');
  console.log('   proxy in:  ', proxyLine.slice(0, 90) + '...');
  console.log('   direct out:', unwrapped);
  console.log('   matches /hls/seg?tok=:', BUNNY_SEG_RE.test(unwrapped));
  console.log('   still stream-proxy:', isStreamProxyUrl(unwrapped));
  console.log('   =>', unitOk ? 'PASS' : 'FAIL');
  console.log('');

  const fakeM3u8 = [
    '#EXTM3U',
    `#EXT-X-KEY:URI="${proxyLine}"`,
    proxyLine,
    'https://osmanitv.b-cdn.net/hls/seg?tok=direct_already',
  ].join('\n');
  const rewritten = rewriteM3u8(fakeM3u8, `https://${CDN_HOST}/master.m3u8`);
  const after = urlsFromM3u8(rewritten, `https://${CDN_HOST}/master.m3u8`);
  const proxyRemain = after.filter(isStreamProxyUrl).length;
  console.log('2) Manifest rewrite (Exo prepareNativeDirectHlsManifest mirror)');
  console.log('   URLs after rewrite:', after);
  console.log('   stream-proxy lines remaining:', proxyRemain);
  console.log('   =>', proxyRemain === 0 ? 'PASS' : 'FAIL');
  console.log('');

  // --- 2. Live catalog ---
  const { ok, body: channels } = await fetchJson('/api/channels');
  if (!ok || !Array.isArray(channels)) {
    console.error('FAIL: could not load /api/channels');
    process.exit(1);
  }

  const modes = { proxy: 0, direct: 0, auto: 0 };
  const withDirect = [];
  for (const c of channels) {
    const mode = normalizeMode(c.stream_delivery_mode ?? c.streamDeliveryMode);
    modes[mode] = (modes[mode] || 0) + 1;
    const d = String(c.direct_stream_url ?? c.directStreamUrl ?? '').trim();
    if (d || mode !== 'proxy') {
      withDirect.push({
        name: c.name,
        mode,
        direct_stream_url: d.slice(0, 100),
        playbackUrl: String(c.playbackUrl ?? c.playback_url ?? '').slice(0, 80),
      });
    }
  }

  console.log('3) Live catalog (/api/channels)');
  console.log('   HLS-related channels:', channels.filter((c) => /\.m3u8|stream-proxy/i.test(JSON.stringify(c))).length);
  console.log('   stream_delivery_mode counts:', modes);
  console.log('   channels with direct_stream_url or non-proxy mode:', withDirect.length);
  if (withDirect.length) {
    console.log('   samples:', JSON.stringify(withDirect.slice(0, 6), null, 2));
  } else {
    console.log('   NOTE: All channels appear to use default proxy mode in live API.');
    console.log('   Direct segment code is deployed (OTA 45310f08…) but NOT active until admin sets mode=auto/direct.');
  }
  console.log('');

  // --- 3. Manifest probes ---
  const probes = channels
    .filter((c) => {
      const mode = normalizeMode(c.stream_delivery_mode ?? c.streamDeliveryMode);
      const d = c.direct_stream_url ?? c.directStreamUrl;
      return mode !== 'proxy' || d;
    })
    .slice(0, 10);

  console.log('4) Live manifest probes (direct/auto channels only)');
  if (!probes.length) {
    console.log('   SKIPPED — no direct/auto channels in catalog to probe.');
    console.log('   Cannot confirm live https://osmanitv.b-cdn.net/hls/seg?tok= from API alone.');
  }

  for (const c of probes) {
    const manifestUrl = String(
      c.direct_stream_url ?? c.directStreamUrl ?? c.playbackUrl ?? c.playback_url ?? c.url ?? '',
    ).trim();
    const mode = normalizeMode(c.stream_delivery_mode ?? c.streamDeliveryMode);
    console.log(`\n   Channel: ${c.name} (mode=${mode})`);
    console.log('   manifest:', manifestUrl.slice(0, 100));

    if (!manifestUrl) {
      console.log('   SKIP: no manifest URL');
      continue;
    }

    try {
      const res = await fetch(manifestUrl);
      console.log('   fetch status:', res.status);
      if (!res.ok) continue;
      const text = await res.text();
      const rawUrls = urlsFromM3u8(text, manifestUrl);
      const fixed = urlsFromM3u8(rewriteM3u8(text, manifestUrl), manifestUrl);

      const sum = (list) => {
        const m = {};
        for (const u of list) m[classify(u)] = (m[classify(u)] || 0) + 1;
        return m;
      };

      console.log('   RAW manifest URL types:', sum(rawUrls));
      console.log('   AFTER app rewrite types:', sum(fixed));
      console.log('   proxy in raw:', rawUrls.filter(isStreamProxyUrl).length);
      console.log('   proxy after rewrite:', fixed.filter(isStreamProxyUrl).length);
      console.log(
        '   bunny /hls/seg?tok= after rewrite:',
        fixed.filter((u) => BUNNY_SEG_RE.test(u)).length,
      );
      const segs = fixed.filter((u) => /\.(ts|m4s)|\/hls\/seg/i.test(u)).slice(0, 3);
      if (segs.length) console.log('   sample segment URLs:', segs);
    } catch (e) {
      console.log('   fetch error:', e.message);
    }
  }

  console.log('\n5) Player runtime behavior (code audit — requires __DEV__ device logs for live proof)');
  console.log('   hls.js:');
  console.log('     - directSegments=true when mode is direct/auto and not hlsForceProxy');
  console.log('     - DirectSegmentLoader calls unwrapProxyUrl() on EVERY manifest + segment request');
  console.log('     - DEV: [hls-segment] segment_source { from, to } when URL changes');
  console.log('     - DEV: [hls-segment] proxy_fallback when direct fails');
  console.log('   ExoPlayer:');
  console.log('     - prepareNativeDirectHlsManifest rewrites master; data: URI if <256KB');
  console.log('     - Native Exo uses remote hlsManifestUrl only (live refresh; no data: URI)');
  console.log('     - Variant fetches use URLs from rewritten master (direct if unwrapped)');
  console.log('   Fallback order: token refresh (2x) → proxy (hlsForceProxy) → backup streams');
  console.log('   Fallback metrics: NOT collected server-side; only __DEV__ client logs.');
  console.log('');

  console.log('6) OTA builds with segment support');
  console.log('   Phase 4 Step 3 OTA group: 45310f08-a9af-4212-a5e7-fc42638ac81a');
  console.log('   Commit: 57367b0');
  console.log('');

  const catalogReady = modes.direct > 0 || modes.auto > 0;
  console.log('=== SUMMARY ===');
  if (unitOk && proxyRemain === 0) {
    console.log('App logic: CONFIRMED — proxy-wrapped segment URLs unwrap to direct (incl. /hls/seg?tok=).');
  }
  if (!catalogReady) {
    console.log(
      'Production playback TODAY: still PROXY mode for all catalog channels — segments go through /stream-proxy until admin enables auto/direct per channel.',
    );
    console.log(
      'To verify on device: set one channel to stream_delivery_mode=auto + direct_stream_url with Bunny /hls/seg playlists,',
      'then filter logcat/Metro for [hls-segment] segment_source — `to` must NOT contain /stream-proxy.',
    );
  } else {
    console.log('Catalog has direct/auto channels — see manifest probe results above.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
