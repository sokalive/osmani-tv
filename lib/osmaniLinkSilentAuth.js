/**
 * Reusable silent Osmani Link authorization for Expo / React Native TV apps.
 *
 * Each app MUST configure its OWN App ID + Access Key (never share across apps).
 * Credentials: EXPO_PUBLIC_OSMANI_LINK_APP_ID / EXPO_PUBLIC_OSMANI_LINK_ACCESS_KEY
 * or Constants.expoConfig.extra.osmaniLinkAppId / osmaniLinkAccessKey.
 *
 * Does not put secrets in channel URLs. Does not log Access Keys or tokens.
 */

import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

export const OSMANI_LINK_ORIGIN = 'https://links.osmanlink.site';
export const OSMANI_AUTHORIZE_URL = `${OSMANI_LINK_ORIGIN}/app_authorize.php`;
export const OSMANI_REFRESH_URL = `${OSMANI_LINK_ORIGIN}/app_token_refresh.php`;

const REFRESH_SKEW_MS = 90_000;

/** @type {{ promise: Promise<any> | null, session: null | { token: string, expiresAt: number, cookieHeader: string, appId: number } }} */
const state = {
  promise: null,
  session: null,
};

function readExtra() {
  return Constants.expoConfig?.extra || Constants.manifest?.extra || {};
}

/**
 * @returns {{ appId: number, accessKey: string, packageName: string, configured: boolean, reason?: string }}
 */
export function getOsmaniLinkCredentials() {
  const extra = readExtra();
  const appIdRaw =
    process.env.EXPO_PUBLIC_OSMANI_LINK_APP_ID ||
    extra.osmaniLinkAppId ||
    '';
  const accessKey = String(
    process.env.EXPO_PUBLIC_OSMANI_LINK_ACCESS_KEY ||
      extra.osmaniLinkAccessKey ||
      '',
  ).trim();
  const appId = Number.parseInt(String(appIdRaw).trim(), 10);
  const packageName = String(
    Application.applicationId ||
      extra.expectedAndroidPackage ||
      '',
  ).trim();

  if (!Number.isFinite(appId) || appId < 1) {
    return {
      appId: 0,
      accessKey: '',
      packageName,
      configured: false,
      reason: 'missing_app_id',
    };
  }
  if (!accessKey) {
    return {
      appId,
      accessKey: '',
      packageName,
      configured: false,
      reason: 'missing_access_key',
    };
  }
  return { appId, accessKey, packageName, configured: true };
}

/**
 * @param {unknown} url
 */
export function isOsmaniLinkEmbedUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (u.hostname.toLowerCase() !== 'links.osmanlink.site') return false;
    return (
      u.pathname === '/embed' ||
      u.pathname === '/embed.php' ||
      u.pathname === '/embed/' ||
      /^\/c\/\d+$/.test(u.pathname) ||
      u.pathname === '/player.php'
    );
  } catch {
    return /links\.osmanlink\.site\/(?:embed(?:\.php)?|c\/\d+|player\.php)/i.test(s);
  }
}

function sessionValid(session, skewMs = REFRESH_SKEW_MS) {
  return Boolean(session?.token) && Number(session.expiresAt) * 1000 - skewMs > Date.now();
}

/**
 * WebView request headers for silent auth (URL stays unchanged).
 * @param {{ token?: string } | null} session
 * @param {{ appId: number, accessKey: string, packageName: string }} creds
 */
export function buildOsmaniLinkAuthHeaders(session, creds) {
  const headers = {
    'X-Osmani-App-Id': String(creds.appId),
    'X-Osmani-Access-Key': creds.accessKey,
  };
  if (creds.packageName) {
    headers['X-Osmani-Package'] = creds.packageName;
  }
  if (session?.token) {
    headers['X-Osmani-Session'] = session.token;
    headers.Cookie = `osmani_st=${session.token}`;
  }
  return headers;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function authorizeOnce() {
  const creds = getOsmaniLinkCredentials();
  if (!creds.configured) {
    const err = new Error(`osmani_link_credentials_blocked:${creds.reason || 'unconfigured'}`);
    err.code = 'BLOCKED';
    err.reason = creds.reason;
    throw err;
  }

  const body = {
    app_id: creds.appId,
    access_key: creds.accessKey,
  };
  if (creds.packageName) {
    body.package_name = creds.packageName;
  }

  const { response, data } = await postJson(OSMANI_AUTHORIZE_URL, body);
  if (!response.ok || !data?.success || !data?.token) {
    const err = new Error('osmani_link_authorize_denied');
    err.code = 'DENIED';
    err.reason = data?.reason || data?.error || `http_${response.status}`;
    throw err;
  }

  const session = {
    token: String(data.token),
    expiresAt: Number(data.expires_at) || Math.floor(Date.now() / 1000) + 900,
    cookieHeader: String(data.cookie_header || ''),
    appId: creds.appId,
  };
  state.session = session;
  return { session, creds, data };
}

async function refreshOnce(token) {
  const { response, data } = await postJson(OSMANI_REFRESH_URL, { token });
  if (!response.ok || !data?.success || !data?.token) {
    return null;
  }
  const session = {
    token: String(data.token),
    expiresAt: Number(data.expires_at) || Math.floor(Date.now() / 1000) + 900,
    cookieHeader: String(data.cookie_header || ''),
    appId: state.session?.appId || 0,
  };
  state.session = session;
  return session;
}

/**
 * Single-flight ensure: returns auth headers for WebView + session metadata.
 * @param {{ force?: boolean }} [opts]
 */
export async function ensureOsmaniLinkSession(opts = {}) {
  const force = Boolean(opts.force);
  const creds = getOsmaniLinkCredentials();
  if (!creds.configured) {
    return {
      ok: false,
      blocked: true,
      reason: creds.reason || 'unconfigured',
      headers: {},
      session: null,
      creds,
    };
  }

  if (!force && sessionValid(state.session)) {
    return {
      ok: true,
      blocked: false,
      reason: 'cached',
      headers: buildOsmaniLinkAuthHeaders(state.session, creds),
      session: state.session,
      creds,
    };
  }

  if (state.promise) {
    return state.promise;
  }

  state.promise = (async () => {
    try {
      if (!force && state.session?.token) {
        const refreshed = await refreshOnce(state.session.token);
        if (refreshed && sessionValid(refreshed, 30_000)) {
          return {
            ok: true,
            blocked: false,
            reason: 'refreshed',
            headers: buildOsmaniLinkAuthHeaders(refreshed, creds),
            session: refreshed,
            creds,
          };
        }
      }
      const { session } = await authorizeOnce();
      return {
        ok: true,
        blocked: false,
        reason: 'authorized',
        headers: buildOsmaniLinkAuthHeaders(session, creds),
        session,
        creds,
      };
    } catch (e) {
      return {
        ok: false,
        blocked: e?.code === 'BLOCKED',
        reason: e?.reason || e?.message || 'authorize_failed',
        headers: {},
        session: null,
        creds,
      };
    } finally {
      state.promise = null;
    }
  })();

  return state.promise;
}

/**
 * Merge Osmani auth headers into an existing WebView source object.
 * @param {{ uri?: string, baseUrl?: string, headers?: Record<string,string> } | null} source
 * @param {Record<string,string>} authHeaders
 */
export function mergeOsmaniLinkWebViewSource(source, authHeaders) {
  if (!source?.uri) return source;
  if (!isOsmaniLinkEmbedUrl(source.uri)) return source;
  const headers = {
    ...(source.headers || {}),
    ...(authHeaders || {}),
  };
  return { ...source, headers };
}

/** Test helper — clears in-memory session (does not log secrets). */
export function __resetOsmaniLinkAuthStateForTests() {
  state.promise = null;
  state.session = null;
}

export function getOsmaniLinkAuthPlatform() {
  return Platform.OS;
}
