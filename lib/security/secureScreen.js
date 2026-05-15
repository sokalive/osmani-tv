import { Platform } from 'react-native';
import { setSecureWindowNative } from './nativeSecurity';

let globalSecureActive = false;
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

/**
 * App-wide FLAG_SECURE + expo-screen-capture (idempotent).
 * Call once at root mount; use {@link refreshSecureScreen} on resume.
 */
export async function ensureGlobalSecureScreen() {
  if (Platform.OS !== 'android') return;
  globalSecureActive = true;
  setSecureWindowNative(true);
  await applyScreenCaptureBlock();
}

/**
 * Re-apply after AppState active / navigation (some OEMs clear window flags).
 */
export async function refreshSecureScreen() {
  if (Platform.OS !== 'android' || !globalSecureActive) return;
  setSecureWindowNative(true);
  await applyScreenCaptureBlock();
}

/** @deprecated Use ensureGlobalSecureScreen — kept for compatibility */
export async function enableSecureScreen() {
  await ensureGlobalSecureScreen();
}

/** Intentionally no-op while global protection is enabled. */
export async function disableSecureScreen() {
  /* app-wide protection stays on */
}
