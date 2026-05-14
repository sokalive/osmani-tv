import Constants from 'expo-constants';
import { OneSignal, LogLevel } from 'react-native-onesignal';

function resolveOneSignalAppId() {
  const fromExtra = Constants.expoConfig?.extra?.oneSignalAppId;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  return '';
}

/**
 * Initializes OneSignal push (FCM on Android via Firebase project linked in OneSignal).
 * Safe to call once at app root; returns cleanup for notification listeners.
 * @returns {() => void}
 */
export function setupOneSignal() {
  const appId = resolveOneSignalAppId();
  if (!appId) {
    if (__DEV__) {
      console.warn(
        '[OneSignal] Set EXPO_PUBLIC_ONESIGNAL_APP_ID (or ONESIGNAL_APP_ID at build time) so extra.oneSignalAppId is populated.',
      );
    }
    return () => {};
  }

  if (__DEV__) {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose);
  } else {
    OneSignal.Debug.setLogLevel(LogLevel.None);
  }

  OneSignal.initialize(appId);

  // Soft prompt; adjust UX (e.g. after onboarding) if you prefer higher opt-in.
  OneSignal.Notifications.requestPermission(false);

  const onClick = (event) => {
    if (__DEV__) {
      console.log('[OneSignal] notification opened:', event?.notification?.notificationId);
    }
  };

  const onForegroundWillDisplay = (event) => {
    try {
      event.getNotification().display();
    } catch {
      /* ignore */
    }
  };

  OneSignal.Notifications.addEventListener('click', onClick);
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', onForegroundWillDisplay);

  return () => {
    try {
      OneSignal.Notifications.removeEventListener('click', onClick);
      OneSignal.Notifications.removeEventListener('foregroundWillDisplay', onForegroundWillDisplay);
    } catch {
      /* ignore */
    }
  };
}
