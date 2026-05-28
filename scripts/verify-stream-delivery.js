/**
 * Sanity checks for Phase 4 direct stream delivery (client).
 * Run: node scripts/verify-stream-delivery.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const delivery = read('lib/streamDelivery.js');
assert(delivery.includes('normalizeStreamDeliveryMode'), 'streamDelivery module');
assert(delivery.includes('resolveChannelPlaybackPlan'), 'playback plan');
assert(delivery.includes('canFallbackToProxyPlayback'), 'proxy fallback guard');

const player = read('lib/playerChannelFromRow.js');
assert(player.includes('streamDeliveryMode'), 'player channel exposes delivery mode');
assert(player.includes('proxyFallbackUrl'), 'player channel exposes proxy fallback');

const screen = read('screens/ChannelPlayerScreen.js');
assert(screen.includes('hlsForceProxy'), 'player tracks proxy fallback state');
assert(screen.includes('attemptPlaybackRecovery'), 'player recovery path');
assert(screen.includes('resolveHlsPlaybackManifestUrl'), 'player uses delivery-aware manifest');

const backend = read('backend/lib/mediaUrlSerializer.js');
assert(backend.includes('direct_stream_url'), 'backend serializer passes direct URL');
assert(backend.includes('stream_delivery_mode'), 'backend serializer passes delivery mode');

console.log('[verify-stream-delivery] ok');
