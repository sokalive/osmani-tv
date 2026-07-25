/**
 * OTA capability markers — bundles without these still ship the Home
 * expired-package TransferredAwayModal and/or the ChannelPlayer gate.
 * Used by {@link ./otaBootGatePolicy.js} to force OTA fetch + reload on v24.
 */
export const KIFURUSHI_KIMEKWISHA_GATE_REMOVED = true;
/** Final removal of TransferredAwayModal expired popup (pay-again / restore). */
export const KIFURUSHI_KIMEKWISHA_POPUP_REMOVED_V2 = true;
/**
 * OTA auto-reload fix: reloadIfNew must not depend on flaky isEmbeddedLaunch,
 * and session hunt must apply the popup-removal bundle without reinstall.
 */
export const KIFURUSHI_KIMEKWISHA_POPUP_REMOVED_V3 = true;
/**
 * Popup-request instrumentation: every former dispatcher logs full stack,
 * API response, route, and OTA identity. Bundles without V4 force-reload
 * into this build so all production devices carry the diagnostics.
 */
export const KIFURUSHI_KIMEKWISHA_POPUP_REMOVED_V4 = true;
