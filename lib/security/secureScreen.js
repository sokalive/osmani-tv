import { Platform } from 'react-native';
import { applyScreenshotPolicy, setScreenshotPolicy } from './screenshotPolicy';

let globalSecureActive = false;

/**
 * App-wide FLAG_SECURE + expo-screen-capture (idempotent).
 * Call once at root mount; use {@link refreshSecureScreen} on resume.
 * Akaunti can temporarily allow captures via {@link setScreenshotPolicy}.
 */
export async function ensureGlobalSecureScreen() {
  if (Platform.OS !== 'android') return;
  globalSecureActive = true;
  await setScreenshotPolicy('protect');
}

/**
 * Re-apply after AppState active / navigation (some OEMs clear window flags).
 * Honors current screen policy (Akaunti allow vs protect).
 */
export async function refreshSecureScreen() {
  if (Platform.OS !== 'android' || !globalSecureActive) return;
  await applyScreenshotPolicy();
}

/** @deprecated Use ensureGlobalSecureScreen — kept for compatibility */
export async function enableSecureScreen() {
  await ensureGlobalSecureScreen();
}

/**
 * Prefer {@link setScreenshotPolicy}('allow_akaunti') for Akaunti Yangu.
 * Legacy no-op when calling disable without policy — protection stays on.
 */
export async function disableSecureScreen() {
  /* use setScreenshotPolicy('allow_akaunti') for scoped allow */
}
