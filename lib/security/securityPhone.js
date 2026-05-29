import AsyncStorage from '@react-native-async-storage/async-storage';

const SECURITY_PHONE_KEY = 'osmani:security_phone_v1';

function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  return digits.length >= 9 ? digits : '';
}

/**
 * Cache subscriber phone for security reports (payment / verify).
 * @param {string | null | undefined} phone
 */
export async function cacheSecurityPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  try {
    await AsyncStorage.setItem(SECURITY_PHONE_KEY, normalized);
  } catch {
    /* ignore */
  }
}

/** @returns {Promise<string>} */
export async function getSecurityPhoneForReport() {
  try {
    return normalizePhone(await AsyncStorage.getItem(SECURITY_PHONE_KEY));
  } catch {
    return '';
  }
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function pickPhoneFromApiBody(body) {
  if (!body || typeof body !== 'object') return '';
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const sub =
    body.subscription && typeof body.subscription === 'object' ? body.subscription : null;
  const candidates = [
    body.phone,
    body.phone_number,
    body.phoneNumber,
    body.msisdn,
    body.buyer_phone,
    body.buyerPhone,
    data?.phone,
    data?.phone_number,
    data?.phoneNumber,
    data?.msisdn,
    data?.buyer_phone,
    data?.buyerPhone,
    sub?.phone,
    sub?.phone_number,
    sub?.phoneNumber,
    sub?.msisdn,
  ];
  for (const c of candidates) {
    const normalized = normalizePhone(c);
    if (normalized) return normalized;
  }
  return '';
}
