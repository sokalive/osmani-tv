/**
 * Phone Subscription Guard — VPS blocks create-order when payment phone already
 * has an active subscription on another device (HTTP 409).
 */

/** @typedef {'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION'|'phone_subscription_conflict'} PhoneSubscriptionConflictCode */

export const PHONE_SUBSCRIPTION_CONFLICT_CODES = new Set([
  'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  'phone_subscription_conflict',
]);

const DEFAULT_MESSAGE_SW =
  'Namba hii ya simu tayari ina kifurushi hai kilicho active kwenye kifaa kingine. ' +
  'Tumia Hamisha Kifurushi au subiri kifurushi kikomae kabla ya kulipia tena.';

/**
 * @param {unknown} body
 * @returns {string|null}
 */
function pickConflictCode(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.code,
    body.error_code,
    body.errorCode,
    body.details?.code,
    body.data?.code,
  ];
  for (const raw of candidates) {
    const code = String(raw ?? '').trim();
    if (!code) continue;
    if (PHONE_SUBSCRIPTION_CONFLICT_CODES.has(code)) return code;
    if (PHONE_SUBSCRIPTION_CONFLICT_CODES.has(code.toLowerCase())) {
      return code.toLowerCase() === 'phone_subscription_conflict'
        ? 'phone_subscription_conflict'
        : code;
    }
  }
  return null;
}

/**
 * @param {number} httpStatus
 * @param {unknown} body
 * @returns {boolean}
 */
export function isPhoneSubscriptionConflict(httpStatus, body) {
  if (Number(httpStatus) !== 409) return false;
  return pickConflictCode(body) != null;
}

/**
 * @param {unknown} body
 * @returns {{
 *   code: PhoneSubscriptionConflictCode|string;
 *   messageSw: string;
 *   existingDeviceId: string|null;
 *   existingExpiry: string|null;
 *   remainingDays: number|null;
 *   existingPackage: string|null;
 * }}
 */
export function parsePhoneSubscriptionConflict(body) {
  const code = pickConflictCode(body) ?? 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION';
  const messageSw = String(
    body?.message_sw ??
      body?.messageSw ??
      body?.message ??
      body?.error ??
      DEFAULT_MESSAGE_SW,
  ).trim();
  const remainingRaw = body?.remaining_days ?? body?.remainingDays;
  const remainingDays = Number(remainingRaw);
  return {
    code,
    messageSw: messageSw || DEFAULT_MESSAGE_SW,
    existingDeviceId:
      body?.existing_device_id != null
        ? String(body.existing_device_id).trim()
        : body?.existingDeviceId != null
          ? String(body.existingDeviceId).trim()
          : null,
    existingExpiry:
      body?.existing_expiry != null
        ? String(body.existing_expiry).trim()
        : body?.existingExpiry != null
          ? String(body.existingExpiry).trim()
          : null,
    remainingDays: Number.isFinite(remainingDays) ? remainingDays : null,
    existingPackage:
      body?.existing_package != null
        ? String(body.existing_package).trim()
        : body?.existingPackage != null
          ? String(body.existingPackage).trim()
          : null,
  };
}
