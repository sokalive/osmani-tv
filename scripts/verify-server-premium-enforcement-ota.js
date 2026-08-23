#!/usr/bin/env node
'use strict';

/**
 * Verify Phase 2 FINAL server-side subscription enforcement integration (OTA).
 * Live probes use synthetic unpaid device_ids only — no payment / DB mutation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

const apiJs = read('api.js');
const authorize = read('api/playbackAuthorize.js');
const nav = read('lib/premiumChannelNavigation.js');
const player = read('screens/ChannelPlayerScreen.js');
const row = read('lib/playerChannelFromRow.js');
const proxy = read('lib/streamProxy.js');
const ent = read('lib/playbackEntitlementClient.js');
const payment = read('api/payment.js');
const security = read('api/security.js');

assert(apiJs.includes('device_id='), 'channels fetch sends device_id');
assert(apiJs.includes('deviceIdentityHeaders'), 'channels fetch sends X-Device-Id');
assert(apiJs.includes('sanitizeCatalogChannelForClient'), 'catalog sanitizes denied premium URLs');
assert(authorize.includes('/api/playback/authorize'), 'authorize endpoint wired');
assert(!authorize.includes('isPremium: true'), 'authorize never sends isPremium:true');
assert(!authorize.includes('subscriptionActive: true'), 'authorize never sends subscriptionActive');
assert(nav.includes('authorizePremiumPlayback'), 'premium navigation calls authorize');
assert(nav.includes('premium_server_authorized'), 'navigates only after server authorize');
assert(player.includes('authorizePremiumPlayback'), 'player gate calls authorize');
assert(player.includes('gate_entitlement_denied'), 'player exits on entitlement deny');
assert(player.includes('attachStreamEntitlementParams'), 'player attaches stream entitlement');
assert(row.includes('sanitizeCatalogChannelForClient'), 'player row sanitizes denied catalog');
assert(proxy.includes('playback_grant') || proxy.includes('device_id'), 'proxy URL can carry entitlement');
assert(ent.includes('proxy_fallback_url'), 'sanitizer clears proxy_fallback when denied');
assert(security.includes('security_nonce') || security.includes('requestSecurityChallenge'), 'security challenge preserved');
assert(payment.includes('createPayment') || payment.includes('/api/payment'), 'payment module present (untouched expected)');

(async () => {
  const unpaid = `phase2final-unpaid-${Date.now().toString(36)}`;

  let r = await fetch(`${BASE}/api/channels`);
  assert(r.status === 200, 'channels anonymous HTTP 200');
  let channels = await r.json();
  const prem = channels.filter((c) => c.accessType === 'premium');
  assert(prem.length > 0, 'premium channels present');
  assert(
    prem.slice(0, 5).every((c) => !c.playbackUrl && c.access_denied === true),
    'anonymous premium URLs redacted',
  );
  const free = channels.find((c) => c.accessType === 'free' || c.channelKind === 'instruction_video');
  assert(free && (free.playbackUrl || free.url), 'free content still has URL');

  r = await fetch(`${BASE}/api/channels?device_id=${encodeURIComponent(unpaid)}`, {
    headers: { 'X-Device-Id': unpaid },
  });
  channels = await r.json();
  const prem2 = channels.find((c) => c.accessType === 'premium');
  assert(prem2?.access_deny_reason === 'no_active_subscription', 'unpaid device deny reason');
  assert(!(prem2?.playbackUrl || ''), 'unpaid premium playbackUrl empty');

  r = await fetch(`${BASE}/api/playback/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': unpaid },
    body: JSON.stringify({
      device_id: unpaid,
      channel_id: prem2?.id ?? 1,
      isPremium: true,
      premium: true,
      paid: true,
      subscriptionActive: true,
    }),
  });
  const fake = await r.json();
  assert(r.status === 403, 'fake premium flags → HTTP 403');
  assert(fake.allowed === false, 'fake premium flags → allowed false');
  assert(
    ['no_active_subscription', 'subscription_inactive', 'subscription_expired'].includes(fake.reason),
    `fake premium reason=${fake.reason}`,
  );

  r = await fetch(`${BASE}/api/playback/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: 1 }),
  });
  const missing = await r.json();
  assert(r.status === 403 && missing.reason === 'missing_device_id', 'missing device_id denied');

  const upstream = 'https://nur.mpingotv.com/v1/player.php?channel=1';
  r = await fetch(
    `${BASE}/stream-proxy?url=${encodeURIComponent(upstream)}&device_id=${encodeURIComponent(unpaid)}`,
  );
  const proxyBody = await r.json().catch(() => ({}));
  assert(r.status === 403, 'stream-proxy denies unpaid');
  assert(proxyBody.code || proxyBody.error, 'stream-proxy deny body');

  r = await fetch(`${BASE}/api/playback/entitlement?device_id=${encodeURIComponent(unpaid)}`);
  const entBody = await r.json();
  assert(r.status === 200 && entBody.allowed === false, 'entitlement endpoint unpaid deny');

  if (process.env.PREMIUM_TEST_PAID_DEVICE_ID) {
    const paid = String(process.env.PREMIUM_TEST_PAID_DEVICE_ID).trim();
    r = await fetch(`${BASE}/api/playback/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': paid },
      body: JSON.stringify({ device_id: paid, channel_id: prem2?.id ?? 1 }),
    });
    const ok = await r.json();
    assert(r.status === 200 && ok.allowed === true && ok.grant, 'paid device authorize success');
    console.log('PASS: paid authorize grant ttl', ok.grant_ttl_sec);
  } else {
    console.log('SKIP: paid authorize (set PREMIUM_TEST_PAID_DEVICE_ID)');
  }

  console.log('\n[verify-server-premium-enforcement-ota] ok');
  console.log('API base:', BASE);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
