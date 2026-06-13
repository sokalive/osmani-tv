/** Cross-context security snapshot for combined access verification. */

const empty = Object.freeze({
  serverPlaybackAllowed: null,
  serverSecurityBlocked: null,
  smartMonitorEnabled: false,
  blockPlayback: false,
  signals: [],
  serverEnforcement: null,
});

let snapshot = { ...empty };

/**
 * @param {Partial<typeof empty>} next
 */
export function setSecurityAccessSnapshot(next) {
  snapshot = { ...snapshot, ...next };
}

export function getSecurityAccessSnapshot() {
  return snapshot;
}

export function resetSecurityAccessSnapshot() {
  snapshot = { ...empty };
}
