import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { normalizeInternationalPhone } from '../lib/internationalPhone';

const RETRY_DELAYS_MS = [0, 800, 1800];

async function wait(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function profileUrl(deviceId, installInstanceId) {
  const base = resolveApiBaseUrl().replace(/\/$/, '');
  const params = new URLSearchParams({ device_id: deviceId });
  if (installInstanceId) params.set('install_instance_id', installInstanceId);
  return `${base}/api/device/profile?${params.toString()}`;
}

function phoneSaveUrl() {
  return `${resolveApiBaseUrl().replace(/\/$/, '')}/api/device/phone`;
}

/**
 * @returns {Promise<{ ok: boolean; hasPhone: boolean; phoneNumber?: string; phoneE164?: string; source?: string | null; error?: string }>}
 */
export async function fetchDevicePhoneProfile() {
  let identity;
  try {
    identity = await getDeviceIdentity();
  } catch (e) {
    const msg = e?.message || 'Device identity unavailable';
    console.log('[PHONE_GATE]', 'identity_failed', msg);
    return { ok: false, hasPhone: false, error: msg };
  }

  const deviceId = identity.subscriptionDeviceId || identity.deviceId;
  const installInstanceId = identity.installInstanceId;
  const url = profileUrl(deviceId, installInstanceId);

  let lastError = 'Network error';

  for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
    await wait(RETRY_DELAYS_MS[i]);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        lastError = body?.error || `HTTP ${res.status}`;
        return { ok: false, hasPhone: false, error: lastError, status: res.status };
      }
      const hasPhone = body?.has_phone === true || body?.hasPhone === true;
      const phoneNumber = String(body?.phone_number ?? body?.phoneNumber ?? '').trim();
      const phoneE164 = String(body?.phone_e164 ?? body?.phoneE164 ?? '').trim();
      const phoneGateEnabled =
        body?.phone_gate_enabled !== false &&
        body?.phoneGateEnabled !== false &&
        body?.phone_number_gate_enabled !== false;
      console.log('[PHONE_GATE]', 'profile', {
        hasPhone,
        phoneGateEnabled,
        source: body?.source ?? null,
      });
      return {
        ok: true,
        hasPhone,
        phoneNumber,
        phoneE164,
        phoneGateEnabled,
        source: body?.source ?? null,
      };
    } catch (e) {
      lastError = e?.message || 'Network error';
    }
  }

  console.log('[PHONE_GATE]', 'profile_failed', lastError);
  return { ok: false, hasPhone: false, error: lastError };
}

/**
 * @param {string} rawPhone
 * @returns {Promise<{ ok: boolean; phoneNumber?: string; phoneE164?: string; error?: string }>}
 */
export async function saveDevicePhoneNumber(rawPhone) {
  const norm = normalizeInternationalPhone(rawPhone);
  if (!norm) {
    return { ok: false, error: 'Nambari ya simu si sahihi.' };
  }

  let identity;
  try {
    identity = await getDeviceIdentity();
  } catch (e) {
    const msg = e?.message || 'Device identity unavailable';
    console.log('[PHONE_GATE]', 'save_identity_failed', msg);
    return { ok: false, error: msg };
  }
  const deviceId = identity.subscriptionDeviceId || identity.deviceId;
  const payload = {
    device_id: deviceId,
    install_instance_id: identity.installInstanceId,
    device_fingerprint: identity.deviceFingerprint,
    android_id: identity.packageAndroidId ?? identity.androidId ?? undefined,
    phone: norm.digits,
    phone_number: norm.digits,
    phone_e164: norm.e164,
  };

  let lastError = 'Network error';

  for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
    await wait(RETRY_DELAYS_MS[i]);
    try {
      const res = await fetch(phoneSaveUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        lastError = body?.error || `HTTP ${res.status}`;
        continue;
      }
      console.log('[PHONE_GATE]', 'saved', { e164: norm.e164 });
      return {
        ok: true,
        phoneNumber: String(body?.phone_number ?? body?.phoneNumber ?? norm.digits),
        phoneE164: String(body?.phone_e164 ?? body?.phoneE164 ?? norm.e164),
      };
    } catch (e) {
      lastError = e?.message || 'Network error';
    }
  }

  console.log('[PHONE_GATE]', 'save_failed', lastError);
  return { ok: false, error: lastError };
}
