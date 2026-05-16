/**
 * Must load before React mounts so the native splash is not auto-hidden too early.
 */
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Minimum branded splash duration before Home (ms). */
export const STARTUP_SPLASH_MIN_MS = 4000;

/** Upper bound for startup hold (ms). */
export const STARTUP_SPLASH_MAX_MS = 5000;
