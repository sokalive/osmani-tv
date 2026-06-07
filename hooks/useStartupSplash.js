import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { syncExpoUpdateBundle } from '../lib/expoUpdatesClient';
import { isEmbeddedLaunchRuntime } from '../lib/embeddedLaunchGate';
import { logFirstLaunchBootDiagnostics } from '../lib/firstLaunchBootDiagnostics';
import { STARTUP_SPLASH_MAX_MS, STARTUP_SPLASH_MIN_MS } from '../lib/startupSplashBoot';

/**
 * Hide the native splash only after embedded-launch OTA gate completes (when applicable).
 *
 * @param {boolean} appBootReady — App shell may render (gate finished).
 */
export function useStartupSplash(appBootReady = true) {
  useEffect(() => {
    if (!appBootReady) return undefined;

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

      logFirstLaunchBootDiagnostics('splash_ready');

      if (!isEmbeddedLaunchRuntime()) {
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
  }, [appBootReady]);
}
