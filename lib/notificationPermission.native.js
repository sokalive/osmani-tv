import { OneSignal } from 'react-native-onesignal';

/**
 * OneSignal is the source of truth for notification permission.
 * @returns {Promise<boolean>}
 */
export async function getOsmaniNotificationPermissionGranted() {
  try {
    return Boolean(await OneSignal.Notifications.getPermissionAsync());
  } catch {
    return false;
  }
}

/**
 * Native OS permission prompt (same path as startup opt-in).
 * @returns {Promise<boolean>}
 */
export async function requestOsmaniNotificationPermission() {
  try {
    const granted = await OneSignal.Notifications.requestPermission(false);
    if (granted) {
      OneSignal.User.pushSubscription.optIn();
    }
    return Boolean(granted);
  } catch {
    return false;
  }
}
