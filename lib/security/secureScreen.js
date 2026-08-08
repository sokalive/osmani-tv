import { Platform } from 'react-native';
import { setSecureWindowNative } from './nativeSecurity';

let globalSecureActive = false;
/** Depth count: while > 0, screenshots are allowed (Akaunti Yangu focus). */
let screenshotExemptDepth = 0;
let screenCaptureModule = null;

async function loadScreenCapture() {
  if (screenCaptureModule) return screenCaptureModule;
  try {
    screenCaptureModule = await import('expo-screen-capture');
    return screenCaptureModule;
  } catch {
    return null;
  }
}

async function applyScreenCaptureBlock() {
  const sc = await loadScreenCapture();
  try {
    await sc?.preventScreenCaptureAsync?.();
  } catch {
    /* ignore */
  }
}

async function applyScreenCaptureAllow() {
  const sc = await loadScreenCapture();
  try {
    await sc?.allowScreenCaptureAsync?.();
  } catch {
    /* ignore */
  }
}

async function applySecureProtection() {
  setSecureWindowNative(true);
  await applyScreenCaptureBlock();
}

async function applyScreenshotExemption() {
  setSecureWindowNative(false);
  await applyScreenCaptureAllow();
}

/**
 * App-wide FLAG_SECURE + expo-screen-capture (idempotent).
 * Call once at root mount; use {@link refreshSecureScreen} on resume.
 */
export async function ensureGlobalSecureScreen() {
  if (Platform.OS !== 'android') return;
  globalSecureActive = true;
  if (screenshotExemptDepth > 0) {
    await applyScreenshotExemption();
    return;
  }
  await applySecureProtection();
}

/**
 * Re-apply after AppState active / navigation (some OEMs clear window flags).
 * While an exemption is active (Akaunti Yangu), re-clear FLAG_SECURE instead —
 * MainActivity onResume may have re-secured the window.
 */
export async function refreshSecureScreen() {
  if (Platform.OS !== 'android' || !globalSecureActive) return;
  if (screenshotExemptDepth > 0) {
    await applyScreenshotExemption();
    return;
  }
  await applySecureProtection();
}

/** @deprecated Use ensureGlobalSecureScreen — kept for compatibility */
export async function enableSecureScreen() {
  await ensureGlobalSecureScreen();
}

/**
 * Begin a scoped screenshot exemption (ref-counted).
 * Used by Akaunti Yangu while focused; does not permanently disable app security.
 */
export async function beginSecureScreenExemption() {
  if (Platform.OS !== 'android') return;
  screenshotExemptDepth += 1;
  await applyScreenshotExemption();
}

/**
 * End a scoped screenshot exemption and restore protection when depth hits 0.
 */
export async function endSecureScreenExemption() {
  if (Platform.OS !== 'android') return;
  screenshotExemptDepth = Math.max(0, screenshotExemptDepth - 1);
  if (screenshotExemptDepth === 0 && globalSecureActive) {
    await applySecureProtection();
  } else if (screenshotExemptDepth > 0) {
    await applyScreenshotExemption();
  }
}

/** @returns {boolean} */
export function isSecureScreenExempt() {
  return screenshotExemptDepth > 0;
}

/**
 * Legacy no-op kept for callers that must not clear app-wide protection.
 * Prefer {@link beginSecureScreenExemption} / {@link endSecureScreenExemption}.
 */
export async function disableSecureScreen() {
  /* app-wide protection stays on unless a scoped exemption is active */
}
