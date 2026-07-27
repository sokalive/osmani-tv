const DEVICE_KEY = 'osmani:web:device_id';
const INSTALL_KEY = 'osmani:web:install_id';
const PHONE_KEY = 'osmani:web:phone';
const FP_KEY = 'osmani:web:fingerprint';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sha256Hex(text) {
  try {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv-${(h >>> 0).toString(16)}`;
  }
}

export function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web_${uuid().replace(/-/g, '').slice(0, 16)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getOrCreateInstallId() {
  let id = localStorage.getItem(INSTALL_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(INSTALL_KEY, id);
  }
  return id;
}

export function getSavedPhone() {
  return localStorage.getItem(PHONE_KEY) || '';
}

export function savePhone(phone) {
  localStorage.setItem(PHONE_KEY, String(phone || '').trim());
}

export async function getDeviceIdentity() {
  const deviceId = getOrCreateDeviceId();
  const installId = getOrCreateInstallId();
  let fingerprint = localStorage.getItem(FP_KEY);
  if (!fingerprint) {
    fingerprint = await sha256Hex(`${deviceId}|osmani-tv-web|${installId}`);
    localStorage.setItem(FP_KEY, fingerprint);
  }
  return {
    deviceId,
    installId,
    fingerprint,
    packageName: 'osmani.tv.web',
    displayedAccountId: deviceId,
    subscriptionDeviceId: deviceId,
  };
}

export function identityPayload(identity, phone) {
  return {
    device_id: identity.deviceId,
    deviceId: identity.deviceId,
    device_fingerprint: identity.fingerprint,
    deviceFingerprint: identity.fingerprint,
    install_instance_id: identity.installId,
    installInstanceId: identity.installId,
    package_name: identity.packageName,
    packageName: identity.packageName,
    displayed_account_id: identity.displayedAccountId,
    displayedAccountId: identity.displayedAccountId,
    subscription_device_id: identity.subscriptionDeviceId,
    subscriptionDeviceId: identity.subscriptionDeviceId,
    phone: phone || undefined,
    identity_candidates: [
      { role: 'web_device_id', device_id: identity.deviceId, deviceId: identity.deviceId },
      { role: 'install_instance_id', device_id: identity.installId, deviceId: identity.installId },
    ],
  };
}
