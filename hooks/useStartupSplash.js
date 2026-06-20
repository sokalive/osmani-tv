import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { syncExpoUpdateBundle } from '../lib/expoUpdatesClient';
import { shouldRunOtaBootGate } from '../lib/otaBootGatePolicy';
import { logFirstLaunchBootDiagnostics } from '../lib/firstLaunchBootDiagnostics';
import { logStartupPaint } from '../lib/startupPaintDiagnostics';
import { STARTUP_SPLASH_MAX_MS, STARTUP_SPLASH_MIN_MS } from '../lib/startupSplashBoot';

/**
 * Hide native splash on first paint — never wait for NavigationContainer.onReady.
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
      logStartupPaint('splash_hide');
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

      logStartupPaint('splash_hook_mounted');
      logFirstLaunchBootDiagnostics('splash_ready');

      if (!shouldRunOtaBootGate()) {
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

/** @deprecated Splash hides on first paint; kept for call-site compatibility. */
export function hideStartupSplashWhenReady(reason = 'navigation_ready') {
  logStartupPaint(`splash_hide_${reason}`);
  void SplashScreen.hideAsync().catch(() => {});
}
