/**
 * Canonical entitlement phase — never treat CHECKING/UNKNOWN as INACTIVE.
 *
 * @typedef {'UNKNOWN'|'CHECKING'|'ACTIVE'|'INACTIVE'|'EXPIRED'|'STALE_ACTIVE'|'ERROR_UNKNOWN'} EntitlementPhase
 */

import { isStaleActiveSubscriptionCache } from './subscriptionCacheRepair';

/**
 * @param {object} [snapshot]
 * @returns {EntitlementPhase}
 */
export function deriveEntitlementPhase(snapshot) {
  const s = snapshot ?? {};
  if (s.isSubscribed === true) return 'ACTIVE';
  if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
  if (s.authoritativeInactiveConfirmed === true) {
    const exp = s.subscriptionExpiresAt ?? s.expiresAt ?? null;
    if (exp) {
      const t = Date.parse(String(exp));
      if (Number.isFinite(t) && t <= Date.now()) return 'EXPIRED';
    }
    return 'INACTIVE';
  }
  if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) {
    return 'ERROR_UNKNOWN';
  }
  return 'UNKNOWN';
}

/**
 * @param {EntitlementPhase|string} phase
 * @returns {boolean}
 */
export function mayOpenPaymentPopup(phase) {
  return phase === 'INACTIVE' || phase === 'EXPIRED';
}

/**
 * @param {EntitlementPhase|string} phase
 * @returns {boolean}
 */
export function mayNavigatePremiumImmediate(phase) {
  return phase === 'ACTIVE' || phase === 'STALE_ACTIVE';
}

/**
 * @param {EntitlementPhase|string} phase
 * @returns {boolean}
 */
export function isEntitlementResolving(phase) {
  return (
    phase === 'UNKNOWN' ||
    phase === 'CHECKING' ||
    phase === 'STALE_ACTIVE' ||
    phase === 'ERROR_UNKNOWN'
  );
}

/**
 * Enrich access snapshot with canonical phase + legacy tri-state alias.
 * @param {object} snapshot
 * @returns {object}
 */
export function withCanonicalEntitlement(snapshot) {
  const s = snapshot ?? {};
  const entitlementPhase = deriveEntitlementPhase(s);
  /** @type {'active'|'inactive'|'resolving'} */
  let entitlementState = 'resolving';
  if (entitlementPhase === 'ACTIVE') entitlementState = 'active';
  else if (mayOpenPaymentPopup(entitlementPhase)) entitlementState = 'inactive';
  return { ...s, entitlementPhase, entitlementState };
}

/**
 * Payment popup only after authoritative inactive/expired — never while checking.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotIsConfirmedInactive(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return mayOpenPaymentPopup(phase);
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotHasActiveSubscription(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return mayNavigatePremiumImmediate(phase) || snapshot?.isSubscribed === true;
}

/**
 * @param {EntitlementPhase|string} phase
 * @returns {boolean}
 */
export function snapshotNeedsEntitlementAwait(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return phase === 'CHECKING' || phase === 'ERROR_UNKNOWN';
}

/**
 * Payment prompt only after authoritative INACTIVE or EXPIRED — never UNKNOWN/CHECKING.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotIsReadyForPaymentFlow(snapshot) {
  const s = snapshot ?? {};
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  return mayOpenPaymentPopup(phase);
}

/**
 * Explicit premium tap may open payment after sync — d3ba89c/d2c3c49 path.
 * Never while CHECKING/ERROR_UNKNOWN or when active/cache-trusted.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotAllowsExplicitTapPayment(snapshot) {
  const s = snapshot ?? {};
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  if (mayOpenPaymentPopup(phase)) return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (mayNavigatePremiumImmediate(phase) || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotIsResolving(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return snapshotNeedsEntitlementAwait(snapshot) || isEntitlementResolving(phase);
}

/**
 * Trustworthy same-device cache for bootstrap (not expired).
 * @param {object|null|undefined} cached
 * @returns {boolean}
 */
export function isTrustworthyActiveCache(cached) {
  if (!cached?.active) return false;
  if (isStaleActiveSubscriptionCache(cached)) return false;
  return true;
}
