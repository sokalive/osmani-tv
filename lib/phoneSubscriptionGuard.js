/**
 * Phone Subscription Guard — legacy VPS 409 when payment phone was treated as
 * entitlement owner. New contract: phone is contact data only; device identity
 * owns entitlement (DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION).
 */

/** @typedef {'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION'|'phone_subscription_conflict'|'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION'|'device_subscription_conflict'} SubscriptionConflictCode */

export const PHONE_SUBSCRIPTION_CONFLICT_CODES = new Set([
  'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  'phone_subscription_conflict',
]);

export const DEVICE_SUBSCRIPTION_CONFLICT_CODES = new Set([
  'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  'device_subscription_conflict',
]);

export const PHONE_GUARD_FALLBACK_TITLE = 'Jaribu Tena';

const GENERIC_BACKEND_MESSAGE_SW = new Set([
  'conflict',
  'error',
  'failed',
  'phone_subscription_conflict',
  'phone already has active subscription',
]);

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function isSuitableBackendMessageSw(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (/^http\s*\d{3}/.test(lower)) return false;
  if (GENERIC_BACKEND_MESSAGE_SW.has(lower)) return false;
  if (s.length < 24) return false;
  return true;
}

/**
 * @param {string|null|undefined} existingPackage
 * @param {number|null|undefined} remainingDays
 * @returns {string}
 */
export function buildPhoneSubscriptionGuardFallbackMessage(existingPackage, remainingDays) {
  // Phone number is never entitlement owner — multi-device same-phone must stay independent.
  void existingPackage;
  void remainingDays;
  return (
    'Malipo hayakuanzishwa kwa sasa. Jaribu tena — kifurushi ni cha kifaa hiki pekee, si namba ya simu.'
  );
}

/**
 * @param {{
 *   rawMessageSw?: string|null;
 *   existingPackage?: string|null;
 *   remainingDays?: number|null;
 * }} conflict
 * @returns {{ title: string; message: string; source: 'backend'|'fallback' }}
 */
export function formatPhoneSubscriptionGuardDisplay(conflict) {
  const rawMessageSw = String(conflict?.rawMessageSw ?? '').trim();
  if (isSuitableBackendMessageSw(rawMessageSw)) {
    return {
      title: 'Taarifa',
      message: rawMessageSw,
      source: 'backend',
    };
  }
  return {
    title: PHONE_GUARD_FALLBACK_TITLE,
    message: buildPhoneSubscriptionGuardFallbackMessage(
      conflict?.existingPackage,
      conflict?.remainingDays,
    ),
    source: 'fallback',
  };
}

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
    if (DEVICE_SUBSCRIPTION_CONFLICT_CODES.has(code)) return code;
    if (DEVICE_SUBSCRIPTION_CONFLICT_CODES.has(code.toLowerCase())) {
      return 'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION';
    }
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
export function isDeviceSubscriptionConflict(httpStatus, body) {
  if (Number(httpStatus) !== 409) return false;
  const code = pickConflictCode(body);
  return (
    code === 'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION' ||
    code === 'device_subscription_conflict'
  );
}

/**
 * @param {number} httpStatus
 * @param {unknown} body
 * @returns {boolean}
 */
export function isPhoneSubscriptionConflict(httpStatus, body) {
  if (Number(httpStatus) !== 409) return false;
  const code = pickConflictCode(body);
  if (!code) return false;
  if (
    code === 'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION' ||
    code === 'device_subscription_conflict'
  ) {
    return false;
  }
  return PHONE_SUBSCRIPTION_CONFLICT_CODES.has(code) || PHONE_SUBSCRIPTION_CONFLICT_CODES.has(String(code).toLowerCase());
}

/**
 * Any create-order 409 that should stop checkout (device or legacy phone).
 * @param {number} httpStatus
 * @param {unknown} body
 */
export function isSubscriptionCheckoutConflict(httpStatus, body) {
  return isDeviceSubscriptionConflict(httpStatus, body) || isPhoneSubscriptionConflict(httpStatus, body);
}

/**
 * @param {unknown} body
 * @returns {{
 *   code: PhoneSubscriptionConflictCode|string;
 *   rawMessageSw: string|null;
 *   messageSw: string;
 *   title: string;
 *   existingDeviceId: string|null;
 *   existingExpiry: string|null;
 *   remainingDays: number|null;
 *   existingPackage: string|null;
 *   displaySource: 'backend'|'fallback';
 * }}
 */
export function parsePhoneSubscriptionConflict(body) {
  const code = pickConflictCode(body) ?? 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION';
  const rawMessageSw = String(body?.message_sw ?? body?.messageSw ?? '').trim() || null;
  const remainingRaw = body?.remaining_days ?? body?.remainingDays;
  const remainingDays = Number(remainingRaw);
  const existingPackage =
    body?.existing_package != null
      ? String(body.existing_package).trim()
      : body?.existingPackage != null
        ? String(body.existingPackage).trim()
        : null;
  const parsed = {
    code,
    rawMessageSw,
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
    existingPackage: existingPackage || null,
  };
  const display = formatPhoneSubscriptionGuardDisplay(parsed);
  return {
    ...parsed,
    title: display.title,
    messageSw: display.message,
    displaySource: display.source,
  };
}
