import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { OneSignal, LogLevel } from 'react-native-onesignal';
import {
  parseNotificationAudience,
  setLastNotificationAudienceSnapshot,
} from './notificationAudience';

/** @type {((url: string) => void) | null} */
let openUrlHandler = null;
/** @type {string[]} */
const pendingOpenUrls = [];
let nativeBootstrapped = false;

function resolveOneSignalAppId() {
  const fromExtra = Constants.expoConfig?.extra?.oneSignalAppId;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  return '';
}

function shouldLogStartup() {
  return Constants.expoConfig?.extra?.oneSignalStartupLogs === true;
}

function logStartup(tag, payload) {
  if (!shouldLogStartup() && !__DEV__) return;
  try {
    console.log('[OneSignal]', tag, payload);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} phase
 */
async function logDeviceSubscriptionState(phase) {
  if (!shouldLogStartup()) return;
  try {
    const [
      permission,
      canRequestPermission,
      pushSubscriptionId,
      pushToken,
      optedIn,
      onesignalId,
    ] = await Promise.all([
      OneSignal.Notifications.getPermissionAsync(),
      OneSignal.Notifications.canRequestPermission(),
      OneSignal.User.pushSubscription.getIdAsync(),
      OneSignal.User.pushSubscription.getTokenAsync(),
      OneSignal.User.pushSubscription.getOptedInAsync(),
      OneSignal.User.getOnesignalId(),
    ]);

    let permissionNative = null;
    if (Platform.OS === 'ios') {
      try {
        permissionNative = await OneSignal.Notifications.permissionNative();
      } catch {
        permissionNative = null;
      }
    }

    logStartup(phase, {
      permission,
      canRequestPermission,
      permissionNative,
      pushSubscriptionId: pushSubscriptionId ?? null,
      pushTokenPresent: Boolean(pushToken),
      optedIn,
      onesignalId: onesignalId ?? null,
    });
  } catch (e) {
    logStartup(phase, { error: String(e) });
  }
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
    for (const key of ['url', 'deep_link', 'deepLink', 'osmani_url', 'osmaniUrl', 'link', 'target_type', 'targetType']) {
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
 * @param {*} event
 */
function dispatchNotificationClick(event) {
  try {
    const n = event?.notification;
    const notificationId = n?.notificationId ?? n?.androidNotificationId ?? null;
    logStartup('notification.click', {
      notificationId,
      hasAdditionalData: Boolean(n?.additionalData),
    });
    if (n) applyAudienceSnapshotFromNotification(n);
    const url = extractOpenUrlFromClickEvent(event);
    if (!url) {
      logStartup('notification.click.no-url', {
        hint: 'Admin push has no app_url/data yet; open is still reported to OneSignal when this event fires.',
      });
      return;
    }
    if (typeof openUrlHandler === 'function') {
      openUrlHandler(url);
    } else {
      pendingOpenUrls.push(url);
    }
  } catch (e) {
    logStartup('notification.click.error', { error: String(e) });
  }
}

/** Shown while app is in foreground; still parse audience for segmentation. */
function handleForegroundWillDisplay(event) {
  try {
    const n = event.getNotification();
    applyAudienceSnapshotFromNotification(n);
    n.display();
  } catch {
    /* ignore */
  }
}

const onPushSubscriptionChange = (event) => {
  const prev = event?.previous;
  const cur = event?.current;
  logStartup('pushSubscription.change', {
    previous: {
      id: prev?.id ?? null,
      optedIn: prev?.optedIn,
      tokenPresent: Boolean(prev?.token),
    },
    current: {
      id: cur?.id ?? null,
      optedIn: cur?.optedIn,
      tokenPresent: Boolean(cur?.token),
    },
  });
};

const onPermissionChange = (granted) => {
  logStartup('permission.change', { granted });
  void logDeviceSubscriptionState('after-permission-change');
};

const onUserChange = (event) => {
  logStartup('user.change', {
    onesignalId: event?.current?.onesignalId ?? null,
    externalId: event?.current?.externalId ?? null,
  });
};

/**
 * Initialize SDK + register listeners once, as early as possible (module load / App import).
 * Click/open attribution to OneSignal requires native init before cold-start tap is handled.
 */
export function bootstrapOneSignalNative() {
  if (nativeBootstrapped) return false;
  const appId = resolveOneSignalAppId();
  if (!appId) return false;

  OneSignal.Debug.setLogLevel(__DEV__ ? LogLevel.Verbose : LogLevel.None);
  OneSignal.initialize(appId);
  nativeBootstrapped = true;

  logStartup('bootstrap.initialize', { appIdPrefix: `${appId.slice(0, 8)}…` });

  OneSignal.User.pushSubscription.addEventListener('change', onPushSubscriptionChange);
  OneSignal.Notifications.addEventListener('permissionChange', onPermissionChange);
  OneSignal.User.addEventListener('change', onUserChange);
  OneSignal.Notifications.addEventListener('click', dispatchNotificationClick);
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', handleForegroundWillDisplay);

  return true;
}

// Run before React mount when App.js imports this module (Metro `.native.js` on iOS/Android).
bootstrapOneSignalNative();

function flushPendingOpenUrls() {
  if (typeof openUrlHandler !== 'function' || pendingOpenUrls.length === 0) return;
  while (pendingOpenUrls.length > 0) {
    const url = pendingOpenUrls.shift();
    if (url) openUrlHandler(url);
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
  bootstrapOneSignalNative();
  openUrlHandler = typeof onOpenUrl === 'function' ? onOpenUrl : null;
  flushPendingOpenUrls();

  void (async () => {
    await logDeviceSubscriptionState('startup-pre-permission');
    try {
      const granted = await OneSignal.Notifications.requestPermission(false);
      logStartup('requestPermission.result', { granted });
      if (granted) {
        OneSignal.User.pushSubscription.optIn();
        logStartup('pushSubscription.optIn', { called: true });
      }
      await logDeviceSubscriptionState('startup-post-permission');
      setTimeout(() => {
        void logDeviceSubscriptionState('startup-deferred-2s');
      }, 2000);
    } catch (e) {
      logStartup('startup-sequence-error', { error: String(e) });
    }
  })();

  return () => {
    openUrlHandler = null;
  };
}
