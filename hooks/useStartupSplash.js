import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { syncExpoUpdateBundle } from '../lib/expoUpdatesClient';
import { STARTUP_SPLASH_MAX_MS, STARTUP_SPLASH_MIN_MS } from '../lib/startupSplashBoot';

/**
 * Keeps the native Expo splash visible for a production-style startup delay,
 * then hides it once before revealing navigation.
 */
export function useStartupSplash() {
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const startedAt = Date.now();
      const expoUpdateSync = syncExpoUpdateBundle('splash').catch(() => null);
      try {
        await SplashScreen.preventAutoHideAsync();
      } catch {
        /* already prevented from startupSplashBoot */
      }

      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const elapsed = Date.now() - startedAt;
      const waitMs = Math.min(
        Math.max(0, STARTUP_SPLASH_MIN_MS - elapsed),
        Math.max(0, STARTUP_SPLASH_MAX_MS - elapsed),
      );
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      try {
        await expoUpdateSync;
      } catch {
        /* embedded bundle remains active */
      }

      if (cancelled) return;

      try {
        await SplashScreen.hideAsync();
      } catch {
        /* ignore */
      }
      if (!cancelled) setSplashHidden(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return splashHidden;
}
