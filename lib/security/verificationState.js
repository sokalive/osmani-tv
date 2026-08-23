/**
 * Derive a coarse verification state for UI/gates from the latest security report.
 *
 * @param {{
 *   loading?: boolean;
 *   reportOk?: boolean | null;
 *   trustState?: string | null;
 *   verificationFresh?: boolean | null;
 *   challengeValid?: boolean | null;
 *   everSevere?: boolean;
 *   serverPlaybackAllowed?: boolean | null;
 *   serverSecurityBlocked?: boolean | null;
 *   blockPlayback?: boolean;
 *   errorCode?: string | null;
 * }} input
 * @returns {'unknown' | 'verifying' | 'verified' | 'degraded' | 'suspicious' | 'blocked'}
 */
export function deriveVerificationState(input) {
  const {
    loading = false,
    reportOk = null,
    trustState = null,
    verificationFresh = null,
    challengeValid = null,
    everSevere = false,
    serverPlaybackAllowed = null,
    serverSecurityBlocked = null,
    blockPlayback = false,
    errorCode = null,
  } = input ?? {};

  if (loading) return 'verifying';

  const trust = String(trustState ?? '').trim().toLowerCase();
  if (trust === 'blocked' || serverSecurityBlocked === true || serverPlaybackAllowed === false) {
    return 'blocked';
  }
  if (blockPlayback && everSevere) return 'blocked';
  if (trust === 'suspicious' || everSevere) return 'suspicious';
  if (trust === 'verified' && verificationFresh === true && challengeValid !== false) {
    return 'verified';
  }
  if (reportOk === false || errorCode === 'challenge_failed' || errorCode === 'transport_error') {
    return 'degraded';
  }
  if (verificationFresh === false || challengeValid === false) return 'degraded';
  if (trust === 'verified') return 'verified';
  return 'unknown';
}
