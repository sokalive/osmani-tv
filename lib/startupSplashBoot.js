/**
 * Must load before React mounts so the native splash is not auto-hidden too early.
 */
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Optional brief branded hold before hide (ms). Keep near zero for fast cold start. */
export const STARTUP_SPLASH_MIN_MS = 0;

/** Hard cap for non-embedded launches (ms). Embedded launch uses OTA loading screen. */
export const STARTUP_SPLASH_MAX_MS = 1200;
