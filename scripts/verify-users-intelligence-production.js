/**
 * Live production checks for Users Intelligence register + block parsing.
 *
 * Usage:
 *   node scripts/verify-users-intelligence-production.js
 *   DEVICE_ID=your-android-id node scripts/verify-users-intelligence-production.js --wait-block 180
 *
 * --wait-block: poll register every 5s until blocked=true or timeout (block device in Admin first).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'https://osmani-admin-api.onrender.com'
).replace(/\/+$/, '');
const REGISTER_URL = `${BASE_URL}/api/users-intelligence/register`;

const root = path.join(__dirname, '..');
const apiSrc = fs.readFileSync(path.join(root, 'api/usersIntelligence.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('OK:', msg);
}

function readBoolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return null;
}

function parseDeviceIntelligenceStatus(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const registry =
    data.registry && typeof data.registry === 'object'
      ? data.registry
      : root.registry && typeof root.registry === 'object'
        ? root.registry
        : null;
  const device =
    data.device && typeof data.device === 'object'
      ? data.device
      : registry && typeof registry === 'object'
        ? registry
        : data;

  const blockedFlag =
    readBoolish(root.blocked) === true ||
    readBoolish(data.blocked) === true ||
    readBoolish(registry?.blocked) === true ||
    readBoolish(device?.blocked) === true;

  const disallowed =
    readBoolish(root.allowed) === false ||
    readBoolish(data.allowed) === false ||
    readBoolish(registry?.allowed) === false ||
    readBoolish(device?.allowed) === false;

  const statusRaw = String(
    registry?.status ?? data.status ?? device?.status ?? root.status ?? '',
  )
    .trim()
    .toLowerCase();

  if (blockedFlag || disallowed || statusRaw === 'blocked') return 'blocked';
  if (
    statusRaw === 'active' ||
    readBoolish(root.allowed) === true ||
    readBoolish(registry?.allowed) === true
  ) {
    return 'active';
  }
  return null;
}

async function registerDevice(deviceId) {
  const deviceFingerprint = crypto
    .createHash('sha256')
    .update(`${deviceId}|osmani-tv|verify-script`)
    .digest('hex');
  const body = {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    android_id: deviceId,
    device_model: 'VerifyScript',
    device_brand: 'Osmani',
    android_version: '14',
    app_version: '1.7.0',
    last_seen: new Date().toISOString(),
  };
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { res, parsed, text };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  if (!apiSrc.includes('/api/users-intelligence/register')) {
    fail('app must POST /api/users-intelligence/register (not register-device)');
  } else {
    ok('app uses production register path');
  }

  const payloadSrc = fs.readFileSync(path.join(root, 'lib/deviceIntelligencePayload.js'), 'utf8');
  if (!payloadSrc.includes('device_id')) {
    fail('register payload must include device_id');
  } else {
    ok('register payload includes device_id');
  }

  if (!apiSrc.includes('registry?.blocked')) {
    fail('parser must read registry.blocked');
  } else {
    ok('parser reads registry.blocked');
  }

  const blockedFixture = {
    ok: true,
    blocked: true,
    allowed: false,
    registry: { status: 'blocked', blocked: true, allowed: false },
  };
  if (parseDeviceIntelligenceStatus(blockedFixture) !== 'blocked') {
    fail('parser must return blocked for production blocked fixture');
  } else {
    ok('parser detects blocked=true fixture');
  }

  const activeFixture = {
    ok: true,
    blocked: false,
    allowed: true,
    registry: { status: 'active', blocked: false, allowed: true },
  };
  if (parseDeviceIntelligenceStatus(activeFixture) !== 'active') {
    fail('parser must return active for production active fixture');
  } else {
    ok('parser detects active fixture');
  }

  const deviceId =
    process.env.DEVICE_ID ||
    `verify-${crypto.randomBytes(4).toString('hex')}-${Date.now().toString(36)}`;

  const { res, parsed, text } = await registerDevice(deviceId);
  if (res.status !== 200) {
    fail(`production register HTTP ${res.status}: ${text.slice(0, 300)}`);
    process.exit(process.exitCode || 1);
    return;
  }
  ok(`production register HTTP 200 for device_id=${deviceId}`);

  if (parsed?.ok !== true) {
    fail(`production register ok!==true: ${text.slice(0, 300)}`);
  } else {
    ok('production register ok=true');
  }

  if (typeof parsed?.blocked !== 'boolean') {
    fail('production response must include top-level blocked boolean');
  } else {
    ok(`production blocked=${parsed.blocked}`);
  }

  const status = parseDeviceIntelligenceStatus(parsed);
  if (!status) {
    fail(`could not parse status from production body: ${text.slice(0, 300)}`);
  } else {
    ok(`parsed status=${status} (matches blocked=${parsed.blocked})`);
  }

  if (status === 'blocked' && parsed.blocked !== true) {
    fail('parsed blocked status but blocked flag is not true');
  }

  const waitArg = process.argv.includes('--wait-block');
  const waitIdx = process.argv.indexOf('--wait-block');
  const waitSec =
    waitArg && process.argv[waitIdx + 1]
      ? Number(process.argv[waitIdx + 1])
      : waitArg
        ? 180
        : 0;

  if (waitSec > 0) {
    console.log(
      `\nPolling every 5s for up to ${waitSec}s — block device_id=${deviceId} in Admin now...\n`,
    );
    const deadline = Date.now() + waitSec * 1000;
    let sawBlocked = false;
    while (Date.now() < deadline) {
      const poll = await registerDevice(deviceId);
      const pollStatus = parseDeviceIntelligenceStatus(poll.parsed);
      console.log(
        `[poll] blocked=${poll.parsed?.blocked} allowed=${poll.parsed?.allowed} status=${pollStatus}`,
      );
      if (poll.parsed?.blocked === true || pollStatus === 'blocked') {
        sawBlocked = true;
        ok('production returned blocked=true after admin block');
        break;
      }
      await sleep(5000);
    }
    if (!sawBlocked) {
      fail(
        `--wait-block timed out without blocked=true (device_id=${deviceId}). Block in Admin and re-run.`,
      );
    }
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
  console.log('\nverify-users-intelligence-production: all checks passed');
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
