import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Platform } from 'react-native';
import { disableSecureScreen, enableSecureScreen } from './secureScreen';

/**
 * Enables FLAG_SECURE while the screen is focused (Android player screens).
 */
export function useSecureScreenOnFocus(enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled || Platform.OS !== 'android') {
        return undefined;
      }
      void enableSecureScreen();
      return () => {
        void disableSecureScreen();
      };
    }, [enabled]),
  );
}
