/**
 * Static checks for Users Intelligence companion app integration.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) {
    console.error(`FAIL: ${label} — missing in ${rel}: ${needle}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${label}`);
}

assertContains('api/usersIntelligence.js', 'registerDeviceIntelligence', 'register API');
assertContains('api/usersIntelligence.js', '/api/users-intelligence/register', 'production register path');
assertContains('api/usersIntelligence.js', 'registry?.blocked', 'registry blocked parse');
assertContains('api/usersIntelligence.js', 'parseDeviceIntelligenceAccess', 'access snapshot parser');
assertContains('api/usersIntelligence.js', 'smart_monitor_enabled', 'smart monitor flag parse');
assertContains('api/usersIntelligence.js', 'explicitUnblock', 'explicit unblock detection');
assertContains('context/DeviceIntelligenceContext.jsx', 'showUnblockModal: result.explicitUnblock', 'unblock modal only on admin unblock');
assertContains('lib/deviceIntelligenceAccess.js', 'isDeviceIntelligenceSmartMonitorEnabled', 'smart monitor imperative hook');
assertContains('lib/adminSseRefreshEvents.js', 'smart_monitor_enabled', 'smart monitor SSE event');
assertContains('lib/security/riskEngine.js', 'serverPlaybackAllowed === true) return ALLOWED', 'server authoritative playback');
assertContains('context/SecurityContext.jsx', 'useSyncExternalStore', 'security reacts to intel access updates');
assertContains('lib/serverIntelAccess.js', 'parseServerIntelAccess', 'server intel parser');
assertContains('lib/deviceIntelligenceAccess.js', 'subscribeDeviceIntelligenceAccess', 'intel pub/sub');
assertContains('api/security.js', 'setLastSecurityReportSnapshot', 'security report cache');
assertContains('lib/runDeviceAccessVerification.js', 'parseServerIntelAccess', 'server-based verification');
assertContains('lib/deviceAccessStatus.js', 'Kifaa Kimefunguliwa', 'Swahili open state');
assertContains('api/security.js', 'device_access_state', 'security report access fields');
assertContains('lib/deviceIntelligencePayload.js', 'device_id', 'device_id in payload');
assertContains('context/DeviceIntelligenceContext.jsx', '15 * 1000', '15s access poll');
assertContains('lib/adminSseRefreshEvents.js', 'device_blocked', 'SSE block event');
assertContains('screens/ChannelPlayerScreen.js', 'device_intelligence_blocked', 'player teardown on block');
assertContains('lib/deviceIntelligencePayload.js', 'device_fingerprint', 'fingerprint field');
assertContains('lib/deviceIntelligencePayload.js', 'android_id', 'android id field');
assertContains('api/usersIntelligence.js', 'last_seen', 'last seen field');
assertContains('components/DeviceIntelligenceGate.jsx', 'Akaunti Imefungiwa', 'blocked modal title');
assertContains('components/DeviceIntelligenceGate.jsx', 'Akaunti Imefunguliwa', 'unblock modal title');
assertContains('components/DeviceIntelligenceGate.jsx', 'Nimeelewa', 'blocked button');
assertContains('components/DeviceIntelligenceGate.jsx', 'acknowledgeBlockedNotice', 'ack dismiss handler');
assertContains('context/DeviceIntelligenceContext.jsx', 'blockedNoticeAckRef', 'block notice ack');
assertContains('lib/deviceIntelligenceAccess.js', 'registerDeviceIntelligenceNavigateHome', 'navigate home hook');
assertContains('components/DeviceIntelligenceGate.jsx', 'Nimekubali', 'unblock button');
assertContains('lib/premiumChannelNavigation.js', 'assertDeviceIntelligenceAllowed', 'playback entry gate');
assertContains('App.js', 'DeviceIntelligenceProvider', 'provider mounted');
assertContains('App.js', 'DeviceIntelligenceGate', 'gate mounted');

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('verify-users-intelligence: all checks passed');
