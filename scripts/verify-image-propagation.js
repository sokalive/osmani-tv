#!/usr/bin/env node
'use strict';

/**
 * Image propagation verification — VPS uploads primary, Bunny fallback, live HEAD probes.
 * Run: node scripts/verify-image-propagation.js
 */

const fs = require('fs');
const path = require('path');

const VPS = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');
const CDN = 'https://osmanitv.b-cdn.net';
const LEGACY = ['osmani-admin-api.onrender.com', 'osmani-tv.onrender.com', '144.91.117.90', 'api.osmanitv.com'];

/** Mirror lib/mediaDelivery.js rewrite (VPS uploads stay on API host). */
function resolveMediaAssetUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/uploads/')) return `${VPS}${s}`;
  if (!/^https?:\/\//i.test(s)) return `${CDN}/${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = LEGACY.some((h) => host === h);
    const isAdminUpload = u.pathname.startsWith('/uploads/') && (isLegacy || host === 'api.osmanitv.com');
    if (!isLegacy && !isAdminUpload) return s;
    if (/\/stream-(proxy|direct)/i.test(s)) return s;
    if (isAdminUpload && host === 'api.osmanitv.com') return s;
    u.protocol = 'https:';
    u.hostname = 'osmanitv.b-cdn.net';
    u.port = '';
    return u.toString();
  } catch {
    return s;
  }
}

function toCdnEquivalentUploadUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('/') ? `${VPS}${s}` : s);
    if (!u.pathname.startsWith('/uploads/')) return '';
    u.protocol = 'https:';
    u.hostname = 'osmanitv.b-cdn.net';
    u.port = '';
    return u.toString();
  } catch {
    return '';
  }
}

function resolveUploadImageCdnFallback(primary, opts = {}) {
  const cdn = toCdnEquivalentUploadUrl(primary);
  if (!cdn || cdn === String(primary).trim()) return null;
  try {
    const u = new URL(cdn);
    if (!u.searchParams.has('width')) u.searchParams.set('width', String(opts.maxWidth ?? 360));
    if (!u.searchParams.has('quality')) u.searchParams.set('quality', String(opts.quality ?? 80));
    return u.toString();
  } catch {
    return cdn;
  }
}

function withImageCacheRevision(url, revision) {
  const base = String(url ?? '').trim();
  if (!base) return '';
  const raw = revision == null ? '' : String(revision).trim();
  if (!raw) return base;
  const token = /^\d+$/.test(raw) ? raw : String(Date.parse(raw) || raw);
  if (!token || token === 'NaN') return base;
  try {
    const u = new URL(base);
    if (!u.searchParams.has('v')) u.searchParams.set('v', token);
    return u.toString();
  } catch {
    return base;
  }
}

let failed = 0;
function pass(msg) {
  console.log('PASS:', msg);
}
function fail(msg) {
  console.error('FAIL:', msg);
  failed += 1;
}

async function headStatus(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    return res.status;
  } catch {
    return 0;
  }
}

const CH18_RAW = 'https://api.osmanitv.com/uploads/1783149413088-b03aaa765ff916cc.jpeg';
const CH1_RAW = 'https://api.osmanitv.com/uploads/1783144959631-62aadf222a687df3.jpeg';

(async () => {
const resolved18 = resolveMediaAssetUrl(CH18_RAW);
if (resolved18.includes('api.osmanitv.com') && !resolved18.includes('b-cdn.net')) {
  pass('channel 18 URL stays on VPS API host (not Bunny rewrite)');
} else {
  fail(`channel 18 must not rewrite to Bunny (got ${resolved18})`);
}

const oldRewrite = (() => {
  try {
    const u = new URL(CH18_RAW);
    u.hostname = 'osmanitv.b-cdn.net';
    return u.toString();
  } catch {
    return '';
  }
})();
if (oldRewrite !== resolved18) {
  pass('fix changes behavior vs old Bunny-only rewrite');
} else {
  fail('rewrite identical to broken Bunny path');
}

const bunny18 = resolveUploadImageCdnFallback(resolved18, { maxWidth: 360, quality: 80 });
const revised = withImageCacheRevision(resolved18, '2026-07-04T07:16:53.198Z');

console.log('\n=== channel 18 Azam 3 HD ===');
console.log('API raw:', CH18_RAW);
console.log('App primary:', revised);
console.log('App fallback:', bunny18);

const vpsStatus = await headStatus(revised);
const cdnStatus = bunny18 ? await headStatus(bunny18) : 0;
console.log('HEAD primary:', vpsStatus, 'HEAD fallback:', cdnStatus);
if (vpsStatus === 200) pass('channel 18 primary VPS HTTP 200');
else fail(`channel 18 primary must be 200 (got ${vpsStatus})`);

const resolved1 = resolveMediaAssetUrl(CH1_RAW);
const fallback1 = resolveUploadImageCdnFallback(resolved1, { maxWidth: 360, quality: 80 });
const vps1 = await headStatus(resolved1);
const cdn1 = fallback1 ? await headStatus(fallback1) : 0;
console.log('\n=== channel 1 legacy CDN-only ===');
console.log('App primary:', resolved1);
console.log('App fallback:', fallback1);
console.log('HEAD primary:', vps1, 'HEAD fallback:', cdn1);
if (cdn1 === 200) pass('legacy channel 1 Bunny fallback HTTP 200');
else fail(`legacy channel 1 Bunny fallback must be 200 (got ${cdn1})`);

const channelsRes = await fetch(`${VPS}/api/channels`, { signal: AbortSignal.timeout(25000) });
const channels = await channelsRes.json();
if (!Array.isArray(channels) || !channels.length) fail('channels API invalid');
else pass(`channels API ${channels.length} rows`);

const bannersRes = await fetch(`${VPS}/api/banners`, { signal: AbortSignal.timeout(25000) });
const banners = await bannersRes.json();
if (!Array.isArray(banners)) fail('banners API invalid');
else pass(`banners API ${banners.length} rows`);

const backup = {
  timestamp: new Date().toISOString(),
  channels: channels.map((c) => ({
    id: c.id,
    name: c.name,
    thumbnail: c.thumbnail ?? c.thumbnail_url ?? c.thumbnailUrl ?? null,
    updatedAt: c.updatedAt ?? c.updated_at ?? null,
  })),
  banners: banners.map((b) => ({
    id: b.id,
    title: b.title,
    image: b.image_url ?? b.imageUrl ?? null,
    updatedAt: b.updatedAt ?? b.updated_at ?? null,
  })),
};

const backupPath = path.join(__dirname, '..', 'image-references-backup.json');
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log('\n[wrote]', backupPath);

let missingBefore = 0;
let missingAfter = 0;
for (const c of backup.channels) {
  if (!c.thumbnail) {
    missingBefore += 1;
    missingAfter += 1;
    continue;
  }
  const oldApp = (() => {
    try {
      const u = new URL(c.thumbnail);
      u.hostname = 'osmanitv.b-cdn.net';
      return u.toString();
    } catch {
      return c.thumbnail;
    }
  })();
  const oldHead = await headStatus(oldApp);
  if (oldHead !== 200) missingBefore += 1;

  const primary = withImageCacheRevision(resolveMediaAssetUrl(c.thumbnail), c.updatedAt);
  const fb = resolveUploadImageCdnFallback(primary, { maxWidth: 360, quality: 80 });
  const ps = await headStatus(primary);
  const fbStatus = fb ? await headStatus(fb) : 0;
  if (ps !== 200 && fbStatus !== 200) missingAfter += 1;
}

console.log('\n=== INVENTORY ===');
console.log('channel images:', backup.channels.filter((c) => c.thumbnail).length);
console.log('banner images:', backup.banners.filter((b) => b.image).length);
console.log('missing/broken with OLD Bunny-only rewrite:', missingBefore);
console.log('missing/broken with NEW VPS+fallback:', missingAfter);
if (missingAfter < missingBefore) pass('fix reduces broken image count');
else if (missingAfter === missingBefore && missingAfter === 0) pass('all images reachable');
else if (missingAfter <= missingBefore) pass('no regression in broken count');
else fail(`broken count increased ${missingBefore} -> ${missingAfter}`);

const root = path.join(__dirname, '..');
const mediaSrc = fs.readFileSync(path.join(root, 'lib/mediaDelivery.js'), 'utf8');
if (mediaSrc.includes('isCurrentApiUploadHost') && mediaSrc.includes('resolveUploadImageCdnFallback')) {
  pass('mediaDelivery VPS upload + CDN fallback helpers');
} else fail('mediaDelivery fix incomplete');

if (fs.readFileSync(path.join(root, 'App.js'), 'utf8').includes('ResilientCatalogImage')) {
  pass('channel cards use ResilientCatalogImage');
} else fail('App.js must use ResilientCatalogImage');

if (fs.readFileSync(path.join(root, 'components/BannerCarousel.js'), 'utf8').includes('ResilientCatalogImage')) {
  pass('banners use ResilientCatalogImage');
} else fail('BannerCarousel must use ResilientCatalogImage');

const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
const sse = fs.readFileSync(path.join(root, 'lib/adminSseRefreshEvents.js'), 'utf8');
if (ctx.includes('invalidateCatalogCache') && sse.includes('channels_changed')) {
  pass('channels_changed invalidates catalog cache');
} else fail('SSE channels_changed path missing');

const pay = fs.readFileSync(path.join(root, 'components/PremiumModal.js'), 'utf8');
if (!pay.includes('ResilientCatalogImage') && !pay.includes('mediaDelivery')) {
  pass('payment flow untouched by image components');
} else fail('payment files unexpectedly modified');

console.log(`\n[verify-image-propagation] ${failed ? 'FAILED' : 'ok'}`);
process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
