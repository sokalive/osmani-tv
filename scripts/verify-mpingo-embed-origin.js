#!/usr/bin/env node
'use strict';

/**
 * Regression: Mpingo player.php must load from nur.mpingotv.com origin,
 * never stream-proxy / stream-direct (which break relative subscriptions.php).
 *
 * Run: node scripts/verify-mpingo-embed-origin.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const playerSrc = read('screens/ChannelPlayerScreen.js');
const streamSrc = read('lib/streamDelivery.js');
const embedSrc = read('lib/embedPlaybackUrl.js');
const hlsSrc = read('lib/hlsPlayback.js');

if (!embedSrc.includes('extractStreamDirectUpstreamUrl')) fail('stream-direct unwrap helper');
else pass('stream-direct unwrap helper');

if (!embedSrc.includes('resolveProviderEmbedPageUrl')) fail('resolveProviderEmbedPageUrl helper');
else pass('resolveProviderEmbedPageUrl helper');

if (!playerSrc.includes('resolveProviderEmbedPageUrl')) fail('ChannelPlayerScreen resolves embed target URI');
else pass('ChannelPlayerScreen resolves embed target URI');

if (!playerSrc.includes('[player][embed] load start')) fail('embed load start diagnostic logging');
else pass('embed load start diagnostic logging');

if (!playerSrc.includes('onNavigationStateChange')) fail('embed navigation logging');
else pass('embed navigation logging');

if (!streamSrc.includes('resolveProviderEmbedPageUrl(candidate)')) fail('finalizePlaybackPlan unwraps embed');
else pass('finalizePlaybackPlan unwraps embed');

if (!hlsSrc.includes('isProviderEmbedPageUrl(s)) return false')) fail('HLS detection excludes embed pages');
else pass('HLS detection excludes embed pages');

function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

function unwrapForEmbed(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  if (isStreamProxyUrl(s)) {
    try {
      return String(new URL(s).searchParams.get('url') ?? '').trim();
    } catch {
      return '';
    }
  }
  if (/\/stream-direct(?:\?|$)/i.test(s)) {
    try {
      const token = new URL(s).searchParams.get('token');
      if (!token) return '';
      for (const part of token.split('.')) {
        try {
          let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
          b64 += pad;
          const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          const upstream = String(payload.u ?? payload.url ?? '').trim();
          if (upstream) return upstream;
        } catch {
          /* try next segment */
        }
      }
    } catch {
      return '';
    }
  }
  return s;
}

function isProviderEmbedPageUrl(url) {
  const inner = unwrapForEmbed(url);
  if (!inner || looksLikeHlsUrl(inner)) return false;
  const pathPart = inner.split(/[#?]/)[0].toLowerCase();
  if (/\.(?:mp4|ts|m2ts|mts)$/i.test(pathPart)) return false;
  return /player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(inner);
}

function resolveProviderEmbedPageUrl(url) {
  if (!isProviderEmbedPageUrl(url)) return '';
  const inner = unwrapForEmbed(url);
  return inner.startsWith('http') ? inner : '';
}

function looksLikeHlsPlaybackUri(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (isProviderEmbedPageUrl(s)) return false;
  if (looksLikeHlsUrl(s)) return true;
  if (/\/stream-direct(?:\?|$)/i.test(s)) return true;
  return false;
}

function resolveChannelPlaybackPlan(input) {
  const rawUrl = String(input.rawUrl ?? '').trim();
  const directUrl = String(input.directStreamUrl ?? '').trim();
  const proxyFallbackUrl = String(input.proxyFallbackUrl ?? '').trim();
  const playUrl = directUrl || proxyFallbackUrl;
  for (const candidate of [rawUrl, playUrl, directUrl, proxyFallbackUrl]) {
    const embed = resolveProviderEmbedPageUrl(candidate);
    if (embed) return { playUrl: embed };
  }
  return { playUrl };
}

const azamPlayer = 'https://nur.mpingotv.com/v3/player.php?channel=1';
const azamProxy =
  'https://osmani-admin-api.onrender.com/stream-proxy?url=' +
  encodeURIComponent(azamPlayer);
const azamDirectPayload = Buffer.from(
  JSON.stringify({ u: azamPlayer, o: 'https://nur.mpingotv.com' }),
).toString('base64url');
const azamDirectToken = `https://osmani-admin-api.onrender.com/stream-direct?token=${azamDirectPayload}.fakesig`;

if (resolveProviderEmbedPageUrl(azamProxy) !== azamPlayer) fail('proxy unwrap');
else pass('proxy unwrap → player.php');

if (resolveProviderEmbedPageUrl(azamDirectToken) !== azamPlayer) fail('stream-direct unwrap');
else pass('stream-direct unwrap → player.php');

if (looksLikeHlsPlaybackUri(azamDirectToken)) fail('player.php stream-direct must not be Exo/HLS');
else pass('player.php stream-direct excluded from Exo/HLS');

const hybridPlan = resolveChannelPlaybackPlan({
  rawUrl: azamPlayer,
  directStreamUrl: azamDirectToken,
  proxyFallbackUrl: azamProxy,
  deliveryMode: 'hybrid',
});
if (hybridPlan.playUrl !== azamPlayer) fail(`hybrid plan got ${hybridPlan.playUrl}`);
else pass('hybrid plan stays player.php');

async function liveApiCheck() {
  const res = await fetch('https://osmani-admin-api.onrender.com/api/channels');
  const channels = await res.json();
  const azam = channels.find((c) => c.name === 'Azam 1 HD');
  if (!azam) {
    fail('live API missing Azam 1 HD');
    return;
  }
  pass('live API Azam 1 HD present');
  const plan = resolveChannelPlaybackPlan({
    rawUrl: String(azam.url ?? '').trim(),
    playbackUrl: azam.playbackUrl,
    directStreamUrl: azam.direct_stream_url,
    proxyFallbackUrl: azam.proxy_playback_url,
    deliveryMode: azam.stream_delivery_mode,
  });
  console.log('\n--- live Azam playback plan ---');
  console.log('  api.url:     ', azam.url);
  console.log('  plan.playUrl:', plan.playUrl);
  console.log('  embed unwrap:', unwrapForEmbed(plan.playUrl));
  if (!plan.playUrl.includes('nur.mpingotv.com/v3/player.php')) {
    fail(`live playUrl must be mpingo player.php: ${plan.playUrl}`);
  } else pass('live playUrl on mpingo origin');
  if (/stream-proxy|stream-direct|osmani-admin-api/.test(plan.playUrl)) {
    fail('live playUrl must not be proxy/direct/admin host');
  } else pass('live playUrl is direct upstream embed');
}

async function main() {
  await liveApiCheck();
  if (process.exitCode) process.exit(1);
  console.log('\n[verify-mpingo-embed-origin] ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
