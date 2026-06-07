/**
 * Must load before React mounts so the native splash is not auto-hidden too early.
 */
import * as SplashScreen from 'expo-splash-screen';
import { beginEmbeddedLaunchGate } from './embeddedLaunchGate';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Kick off embedded-launch OTA gate before React paints (not in useEffect). */
export const embeddedLaunchGatePromise = beginEmbeddedLaunchGate();

/** Optional brief branded hold before hide (ms). Keep near zero for fast cold start. */
export const STARTUP_SPLASH_MIN_MS = 0;

/** Hard cap for non-embedded launches (ms). Embedded launch waits for OTA gate instead. */
export const STARTUP_SPLASH_MAX_MS = 1200;
