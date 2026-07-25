/**
 * OTA capability markers — bundles without these still ship the Home
 * expired-package TransferredAwayModal and/or the ChannelPlayer gate.
 * Used by {@link ./otaBootGatePolicy.js} to force OTA fetch + reload on v24.
 */
export const KIFURUSHI_KIMEKWISHA_GATE_REMOVED = true;
/** Final removal of TransferredAwayModal expired popup (pay-again / restore). */
export const KIFURUSHI_KIMEKWISHA_POPUP_REMOVED_V2 = true;
