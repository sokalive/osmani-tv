import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api';
import { buildDeviceIntelligenceRegistrationBody } from '../lib/deviceIntelligencePayload';

const FIRST_SEEN_KEY = 'osmani:device_intel_first_seen';
const LAST_STATUS_KEY = 'osmani:device_intel_last_status';

const RETRY_DELAYS_MS = [0, 900, 2200];

const REGISTER_URLS = [
  `${BASE_URL}/api/users-intelligence/register-device`,
  `${BASE_URL}/api/users-intelligence/device/register`,
];

const DEBUG =
  __DEV__ || String(process.env.EXPO_PUBLIC_DEVICE_INTEL_LOGS ?? '') === '1';

async function wait(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * @param {unknown} parsed
 * @returns {'blocked' | 'active' | null}
 */
export function parseDeviceIntelligenceStatus(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const device =
    data.device && typeof data.device === 'object' ? data.device : data;

  const blockedFlag =
    readBoolish(data.is_blocked) === true ||
    readBoolish(data.isBlocked) === true ||
    readBoolish(device.is_blocked) === true ||
    readBoolish(device.isBlocked) === true ||
    readBoolish(root.is_blocked) === true;

  const statusRaw = String(
    data.status ?? data.device_status ?? device.status ?? root.status ?? '',
  )
    .trim()
    .toLowerCase();

  if (blockedFlag || statusRaw === 'blocked' || statusRaw === 'banned' || statusRaw === 'suspended') {
    return 'blocked';
  }
  if (
    statusRaw === 'active' ||
    statusRaw === 'ok' ||
    statusRaw === 'allowed' ||
    statusRaw === 'unblocked'
  ) {
    return 'active';
  }
  return null;
}

/**
 * @param {unknown} parsed
 * @returns {string | null}
 */
function pickFirstSeen(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const device =
    data.device && typeof data.device === 'object' ? data.device : data;
  const v =
    data.first_seen ??
    data.firstSeen ??
    device.first_seen ??
    device.firstSeen ??
    root.first_seen ??
    root.firstSeen;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function readStoredFirstSeen() {
  try {
    const v = await AsyncStorage.getItem(FIRST_SEEN_KEY);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

async function persistFirstSeen(iso) {
  if (!iso) return;
  try {
    const existing = await readStoredFirstSeen();
    if (!existing) await AsyncStorage.setItem(FIRST_SEEN_KEY, iso);
  } catch {
    /* ignore */
  }
}

export async function readDeviceIntelligenceLastStatus() {
  try {
    const v = await AsyncStorage.getItem(LAST_STATUS_KEY);
    if (v === 'blocked' || v === 'active') return v;
  } catch {
    /* ignore */
  }
  return null;
}

async function writeDeviceIntelligenceLastStatus(status) {
  if (status !== 'blocked' && status !== 'active') return;
  try {
    await AsyncStorage.setItem(LAST_STATUS_KEY, status);
  } catch {
    /* ignore */
  }
}

/**
 * Register or refresh device with Users Intelligence backend.
 * @returns {Promise<{ ok: boolean; status: 'blocked' | 'active' | null; firstSeen: string | null }>}
 */
export async function registerDeviceIntelligence() {
  const storedFirstSeen = await readStoredFirstSeen();
  const body = await buildDeviceIntelligenceRegistrationBody({
    firstSeen: storedFirstSeen,
  });

  if (!storedFirstSeen && body.first_seen == null) {
    body.first_seen = body.last_seen;
  }

  let lastError = null;

  for (const url of REGISTER_URLS) {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
      await wait(RETRY_DELAYS_MS[i]);
      try {
        if (DEBUG) console.log('[device-intel] POST', url, JSON.stringify(body));
        const res = await fetch(url, {
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
        if (DEBUG) {
          console.log('[device-intel] response', res.status, text?.slice?.(0, 400) ?? '');
        }
        if (res.status === 404 && url === REGISTER_URLS[0]) {
          lastError = new Error('HTTP 404 primary endpoint');
          break;
        }
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }

        const serverFirstSeen = pickFirstSeen(parsed);
        const firstSeen = serverFirstSeen || storedFirstSeen || body.first_seen || body.last_seen;
        await persistFirstSeen(firstSeen);

        const status = parseDeviceIntelligenceStatus(parsed);
        if (status) await writeDeviceIntelligenceLastStatus(status);

        return { ok: true, status, firstSeen };
      } catch (err) {
        lastError = err;
      }
    }
  }

  if (DEBUG) {
    console.log('[device-intel] register failed:', String(lastError ?? 'unknown'));
  }
  return { ok: false, status: null, firstSeen: storedFirstSeen };
}
