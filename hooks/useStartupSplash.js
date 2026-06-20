import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { STARTUP_SPLASH_MAX_MS } from '../lib/startupSplashBoot';
import { logStartupPaint } from '../lib/startupPaintDiagnostics';

/**
 * Hard cap: hide native splash if Navigation never signals ready (backup only).
 * Primary hide happens in NavigationContainer onReady.
 */
export function useStartupSplash() {
  useEffect(() => {
    logStartupPaint('splash_hook_mounted');
    const maxTimer = setTimeout(() => {
      logStartupPaint('splash_hide_backup_timeout');
      void SplashScreen.hideAsync().catch(() => {});
    }, STARTUP_SPLASH_MAX_MS);

    return () => clearTimeout(maxTimer);
  }, []);
}

/**
 * Hide splash once Home navigation is ready to paint.
 */
export function hideStartupSplashWhenReady(reason = 'navigation_ready') {
  logStartupPaint(`splash_hide_${reason}`);
  void SplashScreen.hideAsync().catch(() => {});
}
