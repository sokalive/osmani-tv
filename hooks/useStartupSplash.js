import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import {
  isExpoUpdatesRuntimeEnabled,
  syncExpoUpdateBundle,
} from '../lib/expoUpdatesClient';
import { STARTUP_SPLASH_MAX_MS, STARTUP_SPLASH_MIN_MS } from '../lib/startupSplashBoot';

/** First install must not open channels on stale embedded JS before OTA applies. */
const EMBEDDED_LAUNCH_OTA_TIMEOUT_MS = 15_000;

function isEmbeddedLaunchRuntime() {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  try {
    return Updates.isEmbeddedLaunch === true;
  } catch {
    return false;
  }
}

/**
 * Hide the native splash after first paint. On first launch after install, await OTA
 * sync and reload immediately when a newer bundle exists — prevents first-playback
 * failures from stale embedded stream-direct routing.
 */
export function useStartupSplash() {
  useEffect(() => {
    let cancelled = false;
    let minTimer;
    let maxTimer;

    const hideSplash = async () => {
      if (cancelled) return;
      cancelled = true;
      if (minTimer) clearTimeout(minTimer);
      if (maxTimer) clearTimeout(maxTimer);
      try {
        await SplashScreen.hideAsync();
      } catch {
        /* ignore */
      }
    };

    (async () => {
      try {
        await SplashScreen.preventAutoHideAsync();
      } catch {
        /* already prevented from startupSplashBoot */
      }

      if (isEmbeddedLaunchRuntime()) {
        try {
          console.log('[startup-splash] embedded launch — syncing OTA before home');
          await syncExpoUpdateBundle('splash-embedded', {
            applyOnEmbeddedLaunch: true,
            timeoutMs: EMBEDDED_LAUNCH_OTA_TIMEOUT_MS,
          });
        } catch (e) {
          console.log('[startup-splash] embedded OTA sync failed', e?.message ?? e);
        }
      } else {
        void syncExpoUpdateBundle('splash').catch(() => null);
      }

      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });

      if (cancelled) return;

      const delay = Math.min(STARTUP_SPLASH_MAX_MS, Math.max(STARTUP_SPLASH_MIN_MS, 0));
      minTimer = setTimeout(() => {
        void hideSplash();
      }, delay);

      maxTimer = setTimeout(() => {
        void hideSplash();
      }, STARTUP_SPLASH_MAX_MS);
    })();

    return () => {
      cancelled = true;
      if (minTimer) clearTimeout(minTimer);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, []);
}
