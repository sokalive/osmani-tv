/**
 * Verify HLS channels resolve to BunnyCDN stream-proxy (not Render).
 * Run: node scripts/verify-hls-cdn-playback.js
 */
const API_BASE = process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001';
const CDN_BASE = process.env.MEDIA_CDN_BASE || 'https://osmanitv.b-cdn.net';

function looksLikeHls(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isStreamProxy(url) {
  return /\/stream-proxy(?:\?|$)/i.test(String(url ?? ''));
}

function rewriteRenderToCdn(url) {
  try {
    const u = new URL(url);
    if (u.host === 'osmani-admin-api.onrender.com' || u.host === 'osmani-tv.onrender.com') {
      const cdn = new URL(CDN_BASE);
      u.protocol = cdn.protocol;
      u.host = cdn.host;
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

function buildCdnProxy(rawUrl, row) {
  const params = new URLSearchParams();
  params.set('url', rawUrl);
  if (row.referer) params.set('referer', String(row.referer));
  if (row.origin) params.set('origin', String(row.origin));
  if (row.userAgent || row.user_agent) params.set('ua', String(row.userAgent || row.user_agent));
  return `${CDN_BASE}/stream-proxy?${params.toString()}`;
}

function resolveExpectedPlaybackUrl(row) {
  const playback = row.playbackUrl || row.playback_url;
  if (playback) return rewriteRenderToCdn(String(playback));
  const raw = String(row.url || row.stream_url || '').trim();
  if (looksLikeHls(raw)) return buildCdnProxy(raw, row);
  return raw;
}

async function probeManifest(url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/vnd.apple.mpegurl,*/*' },
      redirect: 'follow',
    });
    const text = await r.text();
    const ok =
      r.ok &&
      (text.includes('#EXTM3U') ||
        String(r.headers.get('content-type') || '').includes('mpegurl'));
    return { status: r.status, ok, bytes: text.length, host: new URL(url).host };
  } catch (e) {
    return { status: 0, ok: false, error: e.message, host: new URL(url).host };
  }
}

async function main() {
  const channels = await fetch(`${API_BASE}/api/channels`).then((r) => r.json());
  const hls = channels.filter((c) => looksLikeHls(c.url) || isStreamProxy(c.playbackUrl));

  console.log('[HLS_CDN_VERIFY] hls channels', hls.length, '/', channels.length);

  const sample = hls.slice(0, 6);
  let cdnHostCount = 0;
  let renderHostCount = 0;
  let manifestOk = 0;

  for (const row of sample) {
    const expected = resolveExpectedPlaybackUrl(row);
    const host = new URL(expected).host;
    if (host.includes('b-cdn.net')) cdnHostCount += 1;
    if (host.includes('onrender.com')) renderHostCount += 1;

    const probe = isStreamProxy(expected) ? await probeManifest(expected) : { skipped: true };
    if (probe.ok) manifestOk += 1;

    console.log('[HLS_CDN_VERIFY]', row.name, {
      expectedHost: host,
      probe,
    });
  }

  console.log('[HLS_CDN_VERIFY] summary', {
    sampled: sample.length,
    cdnHostCount,
    renderHostCount,
    manifestOk,
    defaultProxyBase: `${CDN_BASE}/stream-proxy`,
  });

  if (renderHostCount > 0) {
    console.log(
      '[HLS_CDN_VERIFY] NOTE live API still emits Render playbackUrl — app rewrites to CDN on fetch/build.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
