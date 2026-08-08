/**
 * Screen-scoped screenshot policy: Akaunti Yangu may capture; elsewhere protected.
 */

import { Platform } from 'react-native';
import { setSecureWindowNative } from './nativeSecurity';

let screenCaptureModule = null;
/** @type {'protect' | 'allow_akaunti'} */
let policy = 'protect';

async function loadScreenCapture() {
  if (screenCaptureModule) return screenCaptureModule;
  try {
    screenCaptureModule = await import('expo-screen-capture');
    return screenCaptureModule;
  } catch {
    return null;
  }
}

/**
 * Apply current policy to native window + expo-screen-capture.
 */
export async function applyScreenshotPolicy() {
  if (Platform.OS !== 'android') return;
  const allow = policy === 'allow_akaunti';
  setSecureWindowNative(!allow);
  const sc = await loadScreenCapture();
  try {
    if (allow) {
      await sc?.allowScreenCaptureAsync?.();
    } else {
      await sc?.preventScreenCaptureAsync?.();
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {'protect' | 'allow_akaunti'} next
 */
export async function setScreenshotPolicy(next) {
  policy = next === 'allow_akaunti' ? 'allow_akaunti' : 'protect';
  await applyScreenshotPolicy();
}

/**
 * @returns {'protect' | 'allow_akaunti'}
 */
export function getScreenshotPolicy() {
  return policy;
}
