/**
 * SonicPesa / payment activation waiting-state contract (backend handoff v2).
 * @see docs/cross-ai/sonicpesa-payment-activation-app-handoff.json
 */

export const APP_WAITING_STATE = Object.freeze({
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PROVIDER_CONFIRMED_ACTIVATING: 'PROVIDER_CONFIRMED_ACTIVATING',
  ACTIVE: 'ACTIVE',
  PHONE_CONFLICT: 'PHONE_CONFLICT',
  MOVED_TO_SIBLING_DEVICE: 'MOVED_TO_SIBLING_DEVICE',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
});

const STATE_RANK = Object.freeze({
  [APP_WAITING_STATE.FAILED]: -20,
  [APP_WAITING_STATE.MANUAL_REVIEW_REQUIRED]: -15,
  [APP_WAITING_STATE.PHONE_CONFLICT]: -10,
  [APP_WAITING_STATE.MOVED_TO_SIBLING_DEVICE]: -10,
  [APP_WAITING_STATE.PAYMENT_PENDING]: 0,
  [APP_WAITING_STATE.RETRYING]: 1,
  [APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING]: 2,
  [APP_WAITING_STATE.ACTIVE]: 10,
});

const SUCCESS_STATUS = new Set(['SUCCESS', 'COMPLETED', 'PAID', 'SUCCESSFUL', 'APPROVED']);
const FAILED_STATUS = new Set(['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'DECLINED', 'REJECTED']);

/**
 * @param {unknown} body
 * @returns {{
 *   status: 'SUCCESS'|'PENDING'|'FAILED';
 *   appWaitingState: string;
 *   activationState: string|null;
 *   entitlementActive: boolean;
 *   retryable: boolean;
 *   userActionRequired: boolean;
 *   reason: string;
 *   transactionStatus: string|null;
 *   expiresAt: string|null;
 * }}
 */
export function parsePaymentActivationStatus(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const st = String(raw.status ?? raw.payment_status ?? 'PENDING').toUpperCase();
  const txnStatus = raw.transaction_status != null ? String(raw.transaction_status) : null;
  let status = 'PENDING';
  if (SUCCESS_STATUS.has(st) || txnStatus === 'completed') status = 'SUCCESS';
  else if (FAILED_STATUS.has(st) || txnStatus === 'failed') status = 'FAILED';

  const appWaitingState = String(
    raw.app_waiting_state ?? raw.appWaitingState ?? '',
  ).trim();

  const activationObj =
    raw.activation && typeof raw.activation === 'object' ? raw.activation : null;
  const dataObj = raw.data && typeof raw.data === 'object' ? raw.data : null;
  const subObj = raw.subscription && typeof raw.subscription === 'object' ? raw.subscription : null;

  const derived =
    appWaitingState ||
    (status === 'FAILED'
      ? APP_WAITING_STATE.FAILED
      : status === 'SUCCESS'
        ? APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING
        : APP_WAITING_STATE.PAYMENT_PENDING);

  const expiresRaw =
    raw.expires_at ??
    raw.expiresAt ??
    dataObj?.expires_at ??
    dataObj?.expiresAt ??
    subObj?.expires_at ??
    subObj?.expiresAt ??
    activationObj?.expires_at ??
    activationObj?.expiresAt ??
    null;

  return {
    status,
    appWaitingState: derived,
    activationState:
      raw.activation_state != null
        ? String(raw.activation_state)
        : activationObj?.activation_state != null
          ? String(activationObj.activation_state)
          : null,
    entitlementActive: raw.entitlement_active === true || raw.entitlementActive === true,
    retryable: raw.retryable === true,
    userActionRequired: raw.user_action_required === true || raw.userActionRequired === true,
    reason: String(raw.reason ?? raw.message ?? raw.error ?? ''),
    transactionStatus: txnStatus,
    expiresAt: expiresRaw != null ? String(expiresRaw) : null,
  };
}

/** @param {string} state */
export function waitingStateRank(state) {
  return STATE_RANK[state] ?? 0;
}

/** @param {string} state */
export function isTerminalWaitingState(state) {
  return (
    state === APP_WAITING_STATE.ACTIVE ||
    state === APP_WAITING_STATE.FAILED ||
    state === APP_WAITING_STATE.PHONE_CONFLICT ||
    state === APP_WAITING_STATE.MOVED_TO_SIBLING_DEVICE ||
    state === APP_WAITING_STATE.MANUAL_REVIEW_REQUIRED
  );
}

/**
 * Monotonic acceptance — never regress ACTIVE or terminal conflict states.
 * @param {string|null} current
 * @param {string} incoming
 */
export function shouldAcceptWaitingStateUpdate(current, incoming) {
  const cur = current && STATE_RANK[current] != null ? current : APP_WAITING_STATE.PAYMENT_PENDING;
  const inc = incoming && STATE_RANK[incoming] != null ? incoming : APP_WAITING_STATE.PAYMENT_PENDING;
  if (cur === APP_WAITING_STATE.ACTIVE) return inc === APP_WAITING_STATE.ACTIVE;
  if (
    cur === APP_WAITING_STATE.PHONE_CONFLICT ||
    cur === APP_WAITING_STATE.MOVED_TO_SIBLING_DEVICE ||
    cur === APP_WAITING_STATE.MANUAL_REVIEW_REQUIRED
  ) {
    return inc === cur;
  }
  return waitingStateRank(inc) >= waitingStateRank(cur);
}

/** @param {string} state */
export function mapWaitingStateToProgressStep(state) {
  switch (state) {
    case APP_WAITING_STATE.ACTIVE:
      return 3;
    case APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING:
    case APP_WAITING_STATE.RETRYING:
      return 3;
    case APP_WAITING_STATE.PAYMENT_PENDING:
    default:
      return 1;
  }
}

/**
 * Bounded pool-safe poll intervals per backend handoff.
 * @param {{ elapsedMs: number; waitingState: string; retryable: boolean; paymentConfirmed: boolean }} opts
 */
export function computePollIntervalMs({ elapsedMs, waitingState, retryable, paymentConfirmed }) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const jitter = () => Math.floor(Math.random() * 80);

  // After provider confirm: stay aggressive so ACTIVE is caught immediately.
  if (waitingState === APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING || paymentConfirmed) {
    if (elapsed < 60_000) return 350 + jitter();
    if (elapsed < 120_000) return 600 + jitter();
    return 1200 + jitter();
  }

  if (waitingState === APP_WAITING_STATE.RETRYING && retryable) {
    const base = Math.min(30_000, 1200 * 2 ** Math.min(6, Math.floor(elapsed / 15_000)));
    return base + jitter();
  }

  // PENDING: status-only polls must stay tight — each poll must NOT run heavy probes.
  if (elapsed < 15_000) return 400 + jitter();
  if (elapsed < 90_000) return 700 + jitter();
  return 1500 + jitter();
}

/**
 * Request-generation guard — stale responses cannot regress UI state.
 */
export class PaymentReconcileGuard {
  constructor() {
    this.generation = 0;
    /** @type {string} */
    this.bestState = APP_WAITING_STATE.PAYMENT_PENDING;
  }

  /** @returns {number} */
  nextGeneration() {
    this.generation += 1;
    return this.generation;
  }

  /** @param {number} gen */
  isStale(gen) {
    return gen !== this.generation;
  }

  /**
   * @param {string} incoming
   * @returns {boolean} accepted
   */
  tryAdvance(incoming) {
    if (!shouldAcceptWaitingStateUpdate(this.bestState, incoming)) return false;
    this.bestState = incoming;
    return true;
  }

  reset() {
    this.generation = 0;
    this.bestState = APP_WAITING_STATE.PAYMENT_PENDING;
  }
}
