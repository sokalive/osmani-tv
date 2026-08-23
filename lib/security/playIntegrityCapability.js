/**
 * Play Integrity capability probe for the CURRENT production binary.
 *
 * Phase 2 OTA constraint: do not invent tokens. The released v24 / runtime 1.8.2
 * binary does not embed a Play Integrity / SafetyNet native module, so OTA JS
 * cannot honestly obtain a real attestation token.
 *
 * @returns {{ available: false; reason: string }}
 */
export function getPlayIntegrityCapability() {
  return {
    available: false,
    reason:
      'Play Integrity native attestation is not available in the existing v24 binary and therefore cannot honestly be activated through OTA alone.',
  };
}

/**
 * @param {{ nonce?: string | null }} [_args]
 * @returns {Promise<null>}
 */
export async function obtainPlayIntegrityToken(_args = {}) {
  const cap = getPlayIntegrityCapability();
  if (!cap.available) return null;
  return null;
}
