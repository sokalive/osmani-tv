import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { fetchAdminApiJson, fetchAdminApiResponse } from '../lib/catalogApiFetch';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { readNativeAndroidVersionCode } from '../lib/playVpsApiHost';
import { formatTanzaniaPhoneForApi } from '../lib/tanzaniaPhone';
import { nativeApplicationVersion } from 'expo-application';
import Constants from 'expo-constants';

/** Swahili message when Admin disables OMBA KIFURUSHI (backend authoritative). */
export const OMBA_KIFURUSHI_DISABLED_MESSAGE_SW =
  'Huduma hii imezuiliwa na Admin kwa sasa. Wasiliana na muhudumu kwa msaada zaidi.';

function apiRoot() {
  return `${resolveApiBaseUrl().replace(/\/+$/, '')}/api`;
}

function readRuntimeVersion() {
  try {
    const Updates = require('expo-updates');
    const rv = Updates?.runtimeVersion;
    if (rv != null && String(rv).trim()) return String(rv).trim();
  } catch {
    /* optional */
  }
  const cfg = Constants.expoConfig?.version ?? Constants.manifest?.version;
  return cfg != null ? String(cfg) : '';
}

/**
 * @returns {Promise<{
 *   enabled: boolean;
 *   disabledMessageSw: string;
 *   configVersion: number|null;
 * }>}
 */
export async function fetchOmbaKifurushiSettings() {
  const body = await fetchAdminApiJson('/api/subscription-request/settings', {
    tag: 'omba-kifurushi-settings',
  });
  const enabled =
    body?.omba_kifurushi_enabled !== false && body?.ombaKifurushiEnabled !== false;
  return {
    enabled,
    disabledMessageSw:
      String(body?.disabled_message_sw ?? body?.disabledMessageSw ?? '').trim() ||
      OMBA_KIFURUSHI_DISABLED_MESSAGE_SW,
    configVersion: Number.isFinite(Number(body?.v)) ? Number(body.v) : null,
  };
}

/**
 * Build canonical submit body — device_id matches verify / SSE stream.
 * @param {{ phone: string; planId: string|number; deviceId?: string }} input
 */
export async function buildSubscriptionRequestBody(input) {
  const identity = await getDeviceIdentity();
  const deviceId = String(input.deviceId ?? identity.deviceId ?? '').trim();
  const phone = formatTanzaniaPhoneForApi(input.phone);
  const planId = Number(input.planId);
  const versionCode = readNativeAndroidVersionCode();
  return {
    device_id: deviceId,
    deviceId,
    phone,
    plan_id: planId,
    planId,
    app_version: nativeApplicationVersion ?? '',
    appVersion: nativeApplicationVersion ?? '',
    runtime_version: readRuntimeVersion(),
    runtimeVersion: readRuntimeVersion(),
    client_version_code:
      Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    clientVersionCode:
      Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    request_metadata: { source: 'omba_kifurushi_chako' },
  };
}

/**
 * @returns {Promise<{ ok: true; requestId: string; status: string } | { ok: false; code: string; message: string; httpStatus: number }>}
 */
export async function submitSubscriptionRequest(input) {
  const body = await buildSubscriptionRequestBody(input);
  const { res, parsed } = await fetchAdminApiResponse('/api/subscription-request', {
    method: 'POST',
    body,
    tag: 'omba-kifurushi-submit',
  });
  if (!res.ok) {
    const message = String(parsed?.error ?? parsed?.message ?? `HTTP ${res.status}`).trim();
    return {
      ok: false,
      code: String(parsed?.code ?? '').trim() || (res.status === 403 ? 'OMBA_KIFURUSHI_DISABLED' : ''),
      message:
        res.status === 403
          ? OMBA_KIFURUSHI_DISABLED_MESSAGE_SW
          : message,
      httpStatus: res.status,
    };
  }
  return {
    ok: true,
    requestId: String(parsed?.requestId ?? parsed?.request_id ?? ''),
    status: String(parsed?.status ?? 'PENDING'),
  };
}

/**
 * @param {string} deviceId
 */
export async function fetchSubscriptionRequestStatus(deviceId) {
  const id = String(deviceId ?? '').trim();
  if (!id) return { ok: false, requests: [] };
  const body = await fetchAdminApiJson(
    `/api/subscription-request/status?device_id=${encodeURIComponent(id)}`,
    { tag: 'omba-kifurushi-status' },
  );
  return {
    ok: body?.ok !== false,
    requests: Array.isArray(body?.requests) ? body.requests : [],
  };
}
