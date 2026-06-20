/**
 * Must load before React mounts so the native splash is not auto-hidden too early.
 */
import * as SplashScreen from 'expo-splash-screen';
import { beginEmbeddedLaunchGate } from './embeddedLaunchGate';
import { shouldRunOtaBootGate } from './otaBootGatePolicy';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Start OTA sync before React paints when stale/embedded bundle requires it. */
if (shouldRunOtaBootGate()) {
  try {
    console.log('[embedded-launch-gate]', 'gate_prefetch_started', { beforeReact: true });
  } catch {
    /* ignore */
  }
  beginEmbeddedLaunchGate();
}

/** Optional brief branded hold before hide (ms). Keep near zero for fast cold start. */
export const STARTUP_SPLASH_MIN_MS = 0;

/** Hard cap for non-embedded launches (ms). OTA gate uses Swahili loading screen. */
export const STARTUP_SPLASH_MAX_MS = 1200;
