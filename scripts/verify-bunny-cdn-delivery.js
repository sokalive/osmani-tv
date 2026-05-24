/**
 * Verify BunnyCDN media delivery vs live Admin API payloads.
 * Run: node scripts/verify-bunny-cdn-delivery.js
 */
const API_BASE = process.env.API_URL || 'https://osmani-admin-api.onrender.com';
const CDN_BASE = process.env.MEDIA_CDN_BASE || 'https://osmanitv.b-cdn.net';

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return { url, status: r.status, ok: r.ok, type: r.headers.get('content-type') };
  } catch (e) {
    return { url, status: 0, ok: false, error: e.message };
  }
}

function collectMediaUrls(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (/^https?:\/\//i.test(obj) && (obj.includes('/uploads/') || obj.includes('/stream-proxy'))) {
      out.push(obj);
    }
    return out;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectMediaUrls(x, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectMediaUrls(v, out);
  }
  return out;
}

function hostStats(urls) {
  const counts = {};
  for (const u of urls) {
    try {
      const h = new URL(u).host;
      counts[h] = (counts[h] || 0) + 1;
    } catch {
      counts['(invalid)'] = (counts['(invalid)'] || 0) + 1;
    }
  }
  return counts;
}

async function main() {
  console.log('[CDN_VERIFY] api', API_BASE);
  console.log('[CDN_VERIFY] cdn', CDN_BASE);

  const channels = await fetch(`${API_BASE}/api/channels`).then((r) => r.json());
  const banners = await fetch(`${API_BASE}/api/banners`).then((r) => r.json());

  const mediaUrls = [
    ...collectMediaUrls(channels),
    ...collectMediaUrls(banners),
  ];
  const hosts = hostStats(mediaUrls);
  console.log('[CDN_VERIFY] media URL hosts in live API JSON:', hosts);

  const sampleThumb = mediaUrls.find((u) => u.includes('/uploads/'));
  const cdnThumb = sampleThumb
    ? sampleThumb.replace(/^https?:\/\/[^/]+/i, CDN_BASE)
    : `${CDN_BASE}/uploads/`;

  const cdnChecks = await Promise.all([
    head(cdnThumb),
    head(`${CDN_BASE}/stream-proxy?url=test`),
    head(`${API_BASE}/api/channels`),
  ]);
  console.log('[CDN_VERIFY] probes', JSON.stringify(cdnChecks, null, 2));

  const renderCount = hosts['osmani-admin-api.onrender.com'] || 0;
  const cdnCount = hosts['osmanitv.b-cdn.net'] || 0;

  if (cdnCount > 0 && renderCount === 0) {
    console.log('[CDN_VERIFY] OK — live API already emits BunnyCDN media URLs (existing APKs work without update).');
  } else if (renderCount > 0) {
    console.log(
      '[CDN_VERIFY] ACTION — Admin API still serializes Render media URLs.',
    );
    console.log(
      '  Deploy PUBLIC_MEDIA_CDN_BASE=https://osmanitv.b-cdn.net on osmani-admin-api',
    );
    console.log(
      '  and apply rewriteMediaUrlsInJson() from backend/lib/mediaUrlSerializer.js on /api/channels + /api/banners.',
    );
    console.log(
      '  Images/banners then work on installed APKs immediately (absolute URLs in JSON).',
    );
    console.log(
      '  Stream-proxy on installed APKs still uses client BASE_URL until a new build or playbackUrl in url field with CDN.',
    );
  }

  if (cdnChecks[0]?.ok) {
    console.log('[CDN_VERIFY] CDN uploads reachable.');
  } else {
    console.log('[CDN_VERIFY] WARN — CDN sample upload probe failed:', cdnChecks[0]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
