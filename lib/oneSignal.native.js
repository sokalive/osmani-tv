import Constants from 'expo-constants';
import { OneSignal, LogLevel } from 'react-native-onesignal';
import {
  parseNotificationAudience,
  setLastNotificationAudienceSnapshot,
} from './notificationAudience';

function resolveOneSignalAppId() {
  const fromExtra = Constants.expoConfig?.extra?.oneSignalAppId;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  return '';
}

/**
 * @param {*} event
 * @returns {string | null}
 */
function extractOpenUrlFromClickEvent(event) {
  const resultUrl = event?.result && typeof event.result.url === 'string' ? event.result.url.trim() : '';
  if (resultUrl) return resultUrl;
  const launch = event?.notification && typeof event.notification.launchURL === 'string'
    ? event.notification.launchURL.trim()
    : '';
  if (launch) return launch;
  const data = event?.notification?.additionalData;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = /** @type {Record<string, unknown>} */ (data);
    for (const key of ['url', 'deep_link', 'deepLink', 'osmani_url', 'osmaniUrl', 'link']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * @param {*} notification
 */
function applyAudienceSnapshotFromNotification(notification) {
  try {
    const additional = notification?.additionalData;
    const snapshot = parseNotificationAudience(
      additional && typeof additional === 'object' ? /** @type {Record<string, unknown>} */ (additional) : {},
    );
    setLastNotificationAudienceSnapshot(snapshot);
  } catch {
    setLastNotificationAudienceSnapshot(null);
  }
}

/**
 * @typedef {{ onOpenUrl?: (url: string) => void }} OneSignalSetupOptions
 */

/**
 * @param {OneSignalSetupOptions} [options]
 * @returns {() => void}
 */
export function setupOneSignal(options = {}) {
  const { onOpenUrl } = options;
  const appId = resolveOneSignalAppId();
  if (!appId) {
    return () => {};
  }

  OneSignal.Debug.setLogLevel(__DEV__ ? LogLevel.Verbose : LogLevel.None);
  OneSignal.initialize(appId);
  OneSignal.Notifications.requestPermission(false);

  /** Notification opened from background or cold start (user tapped). */
  const onClick = (event) => {
    try {
      const n = event?.notification;
      if (n) applyAudienceSnapshotFromNotification(n);
      const url = extractOpenUrlFromClickEvent(event);
      if (url && typeof onOpenUrl === 'function') onOpenUrl(url);
    } catch {
      /* ignore */
    }
  };

  /** Shown while app is in foreground; still parse audience for segmentation. */
  const onForegroundWillDisplay = (event) => {
    try {
      const n = event.getNotification();
      applyAudienceSnapshotFromNotification(n);
      n.display();
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
