/**
 * Static checks for notification permission reminder (replaces KIFURUSHI expiry popup).
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

function assertNotContains(rel, needle, label) {
  const text = read(rel);
  if (text.includes(needle)) {
    console.error(`FAIL: ${label} — should not contain in ${rel}: ${needle}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${label}`);
}

assertNotContains('App.js', 'SubscriptionExpiryReminderModal', 'KIFURUSHI modal removed from App');
assertContains('App.js', 'NotificationPermissionReminderGate', 'notification gate mounted');
assertContains('components/NotificationPermissionReminderGate.jsx', 'Pata Habari Zote Muhimu', 'Swahili title');
assertContains('components/NotificationPermissionReminderGate.jsx', 'RUHUSU NOTIFICATIONS', 'allow button');
assertContains('components/NotificationPermissionReminderGate.jsx', 'BAADAYE', 'later button');
assertContains(
  'components/NotificationPermissionReminderGate.jsx',
  'getOsmaniNotificationPermissionGranted',
  'checks permission before show',
);
assertContains(
  'lib/notificationPermission.native.js',
  'getPermissionAsync',
  'OneSignal permission source',
);

if (process.exitCode) process.exit(process.exitCode);
console.log('verify-notification-permission-reminder: all checks passed');
