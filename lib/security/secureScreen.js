import { Platform } from 'react-native';
import { setSecureWindowNative } from './nativeSecurity';

let secureDepth = 0;
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

/**
 * FLAG_SECURE + expo-screen-capture (screenshots, most recordings, recents blur).
 */
export async function enableSecureScreen() {
  if (Platform.OS !== 'android') return;
  secureDepth += 1;
  if (secureDepth > 1) return;
  setSecureWindowNative(true);
  const sc = await loadScreenCapture();
  try {
    await sc?.preventScreenCaptureAsync?.();
  } catch {
    /* ignore */
  }
}

export async function disableSecureScreen() {
  if (Platform.OS !== 'android') return;
  secureDepth = Math.max(0, secureDepth - 1);
  if (secureDepth > 0) return;
  setSecureWindowNative(false);
  const sc = await loadScreenCapture();
  try {
    await sc?.allowScreenCaptureAsync?.();
  } catch {
    /* ignore */
  }
}
