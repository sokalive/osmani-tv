import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { syncExpoUpdateBundle } from '../lib/expoUpdatesClient';
import { STARTUP_SPLASH_MAX_MS, STARTUP_SPLASH_MIN_MS } from '../lib/startupSplashBoot';

/**
 * Hide the native splash quickly after first paint. OTA sync runs in background
 * and must never block Home from rendering.
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

      void syncExpoUpdateBundle('splash').catch(() => null);

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
