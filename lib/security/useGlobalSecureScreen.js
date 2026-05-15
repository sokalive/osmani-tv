import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { ensureGlobalSecureScreen, refreshSecureScreen } from './secureScreen';

/**
 * Enables screenshot / screen-record / recents protection for the entire app.
 * Mount once at the root `App` component.
 */
export function useGlobalSecureScreen() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    void ensureGlobalSecureScreen();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSecureScreen();
      }
    });

    return () => {
      sub.remove();
    };
  }, []);
}
