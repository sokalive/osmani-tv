import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api';
import { buildDeviceIntelligenceRegistrationBody } from '../lib/deviceIntelligencePayload';

const FIRST_SEEN_KEY = 'osmani:device_intel_first_seen';
const LAST_STATUS_KEY = 'osmani:device_intel_last_status';

const RETRY_DELAYS_MS = [0, 900, 2200];

/** Production Users Intelligence register + access check (single endpoint). */
const REGISTER_URL = `${BASE_URL}/api/users-intelligence/register`;

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
    readBoolish(device?.blocked) === true ||
    readBoolish(data.is_blocked) === true ||
    readBoolish(data.isBlocked) === true ||
    readBoolish(device?.is_blocked) === true ||
    readBoolish(device?.isBlocked) === true ||
    readBoolish(root.is_blocked) === true ||
    readBoolish(root.isBlocked) === true;

  const disallowed =
    readBoolish(root.allowed) === false ||
    readBoolish(data.allowed) === false ||
    readBoolish(registry?.allowed) === false ||
    readBoolish(device?.allowed) === false;

  const statusRaw = String(
    registry?.status ??
      data.status ??
      data.device_status ??
      device?.status ??
      root.status ??
      '',
  )
    .trim()
    .toLowerCase();

  if (
    blockedFlag ||
    disallowed ||
    statusRaw === 'blocked' ||
    statusRaw === 'banned' ||
    statusRaw === 'suspended'
  ) {
    return 'blocked';
  }
  if (
    statusRaw === 'active' ||
    statusRaw === 'ok' ||
    statusRaw === 'allowed' ||
    statusRaw === 'unblocked' ||
    readBoolish(root.allowed) === true ||
    readBoolish(registry?.allowed) === true ||
    readBoolish(device?.allowed) === true
  ) {
    return 'active';
  }
  return null;
}

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function parseDeviceIntelligenceBlocked(parsed) {
  return parseDeviceIntelligenceStatus(parsed) === 'blocked';
}

/**
 * @param {unknown} parsed
 * @returns {string | null}
 */
function pickFirstSeen(parsed) {
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
  const v =
    data.first_seen ??
    data.firstSeen ??
    registry?.firstSeenAt ??
    registry?.first_seen_at ??
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
 * @returns {Promise<{ ok: boolean; status: 'blocked' | 'active' | null; blocked: boolean; firstSeen: string | null; raw?: unknown }>}
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

  for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
    await wait(RETRY_DELAYS_MS[i]);
    try {
      if (DEBUG) console.log('[device-intel] POST', REGISTER_URL, JSON.stringify(body));
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
      if (DEBUG) {
        console.log('[device-intel] response', res.status, text?.slice?.(0, 400) ?? '');
      }
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}: ${text?.slice?.(0, 200) ?? ''}`);
        continue;
      }

      const serverFirstSeen = pickFirstSeen(parsed);
      const firstSeen = serverFirstSeen || storedFirstSeen || body.first_seen || body.last_seen;
      await persistFirstSeen(firstSeen);

      const status = parseDeviceIntelligenceStatus(parsed);
      const blocked = status === 'blocked';
      if (status) await writeDeviceIntelligenceLastStatus(status);

      return { ok: true, status, blocked, firstSeen, raw: parsed };
    } catch (err) {
      lastError = err;
    }
  }

  if (DEBUG) {
    console.log('[device-intel] register failed:', String(lastError ?? 'unknown'));
  }
  return { ok: false, status: null, blocked: false, firstSeen: storedFirstSeen };
}
