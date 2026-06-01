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
assertContains('lib/deviceIntelligencePayload.js', 'device_fingerprint', 'fingerprint field');
assertContains('lib/deviceIntelligencePayload.js', 'android_id', 'android id field');
assertContains('api/usersIntelligence.js', 'last_seen', 'last seen field');
assertContains('components/DeviceIntelligenceGate.jsx', 'Akaunti Imefungiwa', 'blocked modal title');
assertContains('components/DeviceIntelligenceGate.jsx', 'Akaunti Imefunguliwa', 'unblock modal title');
assertContains('components/DeviceIntelligenceGate.jsx', 'Nimeelewa', 'blocked button');
assertContains('components/DeviceIntelligenceGate.jsx', 'Nimekubali', 'unblock button');
assertContains('lib/premiumChannelNavigation.js', 'assertDeviceIntelligenceAllowed', 'playback entry gate');
assertContains('App.js', 'DeviceIntelligenceProvider', 'provider mounted');
assertContains('App.js', 'DeviceIntelligenceGate', 'gate mounted');

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('verify-users-intelligence: all checks passed');
