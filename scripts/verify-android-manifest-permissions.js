#!/usr/bin/env node
'use strict';

/**
 * Verify production Android manifest blocks gallery/storage permissions from dependency merge.
 * Run: node scripts/verify-android-manifest-permissions.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

const FORBIDDEN = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
];

const MUST_BLOCK = [
  ...FORBIDDEN,
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const DEPENDENCY_SOURCES = {
  'android.permission.READ_MEDIA_IMAGES': 'expo-screen-capture',
  'android.permission.READ_EXTERNAL_STORAGE': 'expo-screen-capture, expo-image, expo-file-system',
  'android.permission.WRITE_EXTERNAL_STORAGE': 'expo-file-system',
};

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function runPrebuild() {
  const env = {
    ...process.env,
    EXPO_PUBLIC_APK_INSTALLER_ENABLED: '0',
    EAS_BUILD_PROFILE: 'production',
    CI: '1',
  };
  const cmd = 'npx expo prebuild --platform android --no-install';
  try {
    execSync(`${cmd} --clean`, { cwd: root, env, stdio: 'inherit' });
  } catch (e) {
    console.warn('[verify-android-manifest-permissions] --clean failed, retrying without clean');
    execSync(cmd, { cwd: root, env, stdio: 'inherit' });
  }
}

function parseManifest(xml) {
  const blocked = new Set();
  const granted = new Set();

  for (const match of xml.matchAll(
    /<uses-permission[^>]*android:name="([^"]+)"([^/>]*)\/?>/g,
  )) {
    const name = match[1];
    const attrs = match[2] || '';
    if (/tools:node="remove"/.test(attrs) || /tools:node='remove'/.test(attrs)) {
      blocked.add(name);
    } else {
      granted.add(name);
    }
  }

  return { blocked, granted };
}

console.log('[verify-android-manifest-permissions] prebuild (production env)...');
runPrebuild();

if (!fs.existsSync(manifestPath)) {
  fail(`missing manifest at ${manifestPath}`);
  process.exit(1);
}

const xml = fs.readFileSync(manifestPath, 'utf8');
const { blocked, granted } = parseManifest(xml);

if (!/xmlns:tools="http:\/\/schemas\.android\.com\/tools"/.test(xml)) {
  fail('manifest missing xmlns:tools namespace required for permission blocking');
} else {
  pass('tools namespace present');
}

for (const perm of FORBIDDEN) {
  if (granted.has(perm)) {
    fail(`${perm} is granted in app manifest (must not appear without tools:node="remove")`);
  } else {
    pass(`${perm} not granted in app manifest`);
  }
}

for (const perm of MUST_BLOCK) {
  if (!blocked.has(perm)) {
    fail(`${perm} missing tools:node="remove" merger block`);
  } else {
    pass(`${perm} blocked via tools:node="remove"`);
  }
}

console.log('\n--- dependency sources (Gradle merge) ---');
for (const [perm, src] of Object.entries(DEPENDENCY_SOURCES)) {
  console.log(`  ${perm} ← ${src}`);
}
console.log('  READ_MEDIA_VIDEO — blocked preemptively (Play photo/video policy)');

console.log('\n--- granted permissions (app manifest) ---');
for (const perm of [...granted].sort()) {
  console.log(`  ${perm}`);
}

if (!process.exitCode) {
  console.log('\n[verify-android-manifest-permissions] ok');
}
