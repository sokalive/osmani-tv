import { Platform } from 'react-native';
import { OneSignal } from 'react-native-onesignal';
import { getDeviceIdentity } from './deviceIdentity';
import { readNativeAndroidVersionCode } from './playVpsApiHost';

function logPushReg(payload) {
  try {
    console.log('[PUSH_REG]', JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function collectOneSignalPushSnapshot() {
  try {
    const [
      permission,
      canRequestPermission,
      optedIn,
      pushSubscriptionId,
      pushToken,
      onesignalId,
    ] = await Promise.all([
      OneSignal.Notifications.getPermissionAsync(),
      OneSignal.Notifications.canRequestPermission(),
      OneSignal.User.pushSubscription.getOptedInAsync(),
      OneSignal.User.pushSubscription.getIdAsync(),
      OneSignal.User.pushSubscription.getTokenAsync(),
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

    return {
      permission: Boolean(permission),
      canRequestPermission: Boolean(canRequestPermission),
      permissionNative,
      optedIn: Boolean(optedIn),
      pushSubscriptionId: pushSubscriptionId ?? null,
      pushTokenPresent: Boolean(pushToken),
      onesignalId: onesignalId ?? null,
      versionCode: readNativeAndroidVersionCode(),
    };
  } catch (e) {
    return {
      error: String(e?.message ?? e),
      versionCode: readNativeAndroidVersionCode(),
    };
  }
}

/**
 * Repair push subscription: external user id + opt-in when OS permission granted.
 * Safe on all Play runtimes (v16–v24); does not depend on notification image payloads.
 *
 * @param {string} [reason]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function ensureOneSignalPushRegistration(reason = 'manual') {
  const versionCode = readNativeAndroidVersionCode();
  const out = { reason, versionCode, phase: 'start' };

  try {
    const identity = await getDeviceIdentity();
    const deviceId = String(identity?.deviceId ?? '').trim();
    if (deviceId) {
      OneSignal.login(deviceId);
      out.externalIdLinked = true;
      out.deviceIdPrefix = `${deviceId.slice(0, 8)}…`;
    } else {
      out.externalIdLinked = false;
    }

    const permission = Boolean(await OneSignal.Notifications.getPermissionAsync());
    out.permission = permission;

    if (permission) {
      OneSignal.User.pushSubscription.optIn();
      out.optInCalled = true;
    } else {
      out.optInCalled = false;
    }

    await sleep(600);
    const snap = await collectOneSignalPushSnapshot();
    Object.assign(out, snap ?? {}, { phase: 'done' });
    logPushReg(out);
    return out;
  } catch (e) {
    out.phase = 'error';
    out.error = String(e?.message ?? e);
    logPushReg(out);
    return out;
  }
}
