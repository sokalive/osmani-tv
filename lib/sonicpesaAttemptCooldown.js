/**
 * SonicPesa customer attempt cooldown — server contract only.
 * Live Admin (commit e6135bf) rejects the next create-order with:
 * HTTP 429, code SONICPESA_PAY_ATTEMPT_COOLDOWN, cooldown_seconds, cooldown_until.
 * There is no separate read endpoint. After cooldown_until, the next deliberate
 * create-order is the server revalidation. The app must not count attempts itself.
 */

export const SONICPESA_ATTEMPT_COOLDOWN_CODE = 'SONICPESA_PAY_ATTEMPT_COOLDOWN';
export const SONICPESA_PIN_WAIT_SEC = 120;

export const COOLDOWN_POPUP_COPY = Object.freeze({
  heading: 'Tafadhali subiri kidogo',
  message:
    'Umefikia kikomo cha maombi 3 ya\nmalipo. Tafadhali subiri dakika 3\nkabla ya kujaribu kulipia tena.',
  button: 'SAWA',
  support: 'Unaweza kujaribu tena baada ya muda kuisha.',
});

export function formatPinCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * @param {Record<string, unknown>|null|undefined} body
 * @param {number} httpStatus
 */
export function parseSonicpesaAttemptCooldown(body, httpStatus) {
  if (Number(httpStatus) !== 429) return null;
  if (!body || typeof body !== 'object') return null;
  if (String(body.code ?? '') !== SONICPESA_ATTEMPT_COOLDOWN_CODE) return null;
  const untilMs = Date.parse(String(body.cooldown_until ?? body.cooldownUntil ?? ''));
  if (!Number.isFinite(untilMs)) return null;
  const seconds = Number(body.cooldown_seconds ?? body.cooldownSeconds);
  return {
    code: SONICPESA_ATTEMPT_COOLDOWN_CODE,
    cooldownUntilMs: untilMs,
    cooldownSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 180,
  };
}

/**
 * @param {{ code?: string|null, cooldownUntil?: string|null, cooldownSeconds?: number|null, httpStatus?: number|null }|null|undefined} error
 */
export function cooldownFromCheckoutError(error) {
  if (!error || typeof error !== 'object') return null;
  return parseSonicpesaAttemptCooldown(
    {
      code: error.code,
      cooldown_until: error.cooldownUntil,
      cooldown_seconds: error.cooldownSeconds,
    },
    error.httpStatus,
  );
}

/**
 * @param {{ cooldownUntilMs?: number|null }|null|undefined} stored
 * @param {number} nowMs
 * @returns {{ action: 'allow_server'|'block_local'|'revalidate_server', cooldownUntilMs: number|null }}
 */
export function sonicpesaCheckoutGate(stored, nowMs) {
  const until = Number(stored?.cooldownUntilMs);
  const now = Number(nowMs);
  if (!Number.isFinite(until)) return { action: 'allow_server', cooldownUntilMs: null };
  if (!Number.isFinite(now)) return { action: 'block_local', cooldownUntilMs: until };
  if (now < until) return { action: 'block_local', cooldownUntilMs: until };
  return { action: 'revalidate_server', cooldownUntilMs: until };
}

/**
 * Initiation failure never opens the removed generic retry popup.
 * SonicPesa attempt-limit responses use the cooldown dialog.
 * @param {string|null|undefined} provider
 * @param {object|null|undefined} error
 * @returns {'cooldown_popup'|'payment_screen'}
 */
export function sonicpesaInitFailurePresentation(provider, error) {
  if (String(provider ?? '') === 'sonicpesa' && cooldownFromCheckoutError(error)) return 'cooldown_popup';
  return 'payment_screen';
}

/** PIN timer end is not a failed payment and must not create another order. */
export function sonicpesaPinTimerExpiredAction() {
  return {
    closeModal: true,
    createOrder: false,
    showGenericFailure: false,
    definitiveFailure: false,
  };
}

/** GHAIRI leaves the channel flow without starting a payment. */
export function sonicpesaCancelAction() {
  return { closeModal: true, createOrder: false };
}

/**
 * A SonicPesa rejection or failed status stays on the payment waiting screen.
 * It must not open the removed generic failure popup or start another order.
 */
export function sonicpesaPaymentFailureAction() {
  return {
    stayOnWaitingScreen: true,
    showGenericFailurePopup: false,
    createOrder: false,
    grantEntitlement: false,
  };
}
