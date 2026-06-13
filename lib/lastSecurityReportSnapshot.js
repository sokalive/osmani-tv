/** Last successful security-report parse — survives clean-scan dedupe skips. */

const empty = Object.freeze({
  serverPlaybackAllowed: null,
  serverSecurityBlocked: null,
  smartMonitorEnabled: false,
  enforcement: null,
  playbackGateReason: null,
  at: 0,
});

let snapshot = { ...empty };

/**
 * @param {Partial<typeof empty>} next
 */
export function setLastSecurityReportSnapshot(next) {
  snapshot = { ...snapshot, ...next, at: Date.now() };
}

export function getLastSecurityReportSnapshot() {
  return snapshot;
}
