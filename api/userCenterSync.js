import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { buildUserCenterDeviceEnvelope } from '../lib/userCenterDeviceEnvelope';

const RETRY_DELAYS_MS = [0, 600, 1500];
const DEDUPE_MS = 4000;

/** @type {Map<string, number>} */
const recentKeys = new Map();

function dedupeKey(type, suffix = '') {
  return `${type}:${suffix}`;
}

function shouldSkipDedupe(key) {
  const now = Date.now();
  const prev = recentKeys.get(key);
  if (prev != null && now - prev < DEDUPE_MS) return true;
  recentKeys.set(key, now);
  if (recentKeys.size > 200) {
    for (const [k, t] of recentKeys) {
      if (now - t > DEDUPE_MS * 4) recentKeys.delete(k);
    }
  }
  return false;
}

async function wait(ms) {
  if (!ms) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * POST JSON to first path that succeeds (404/405 tries next).
 * Never throws — telemetry must not break UX.
 */
async function postFirstOk(paths, body) {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  let lastStatus = 0;
  for (const path of paths) {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
      await wait(RETRY_DELAYS_MS[i]);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        lastStatus = res.status;
        if (res.ok) {
          console.log('[USER_CENTER_SYNC]', path, body.event_type ?? body.event ?? 'ok');
          return true;
        }
        if (res.status === 404 || res.status === 405) break;
      } catch (e) {
        console.log('[USER_CENTER_SYNC]', 'post_error', path, String(e?.message ?? e));
      }
    }
  }
  if (lastStatus && lastStatus !== 404) {
    console.log('[USER_CENTER_SYNC]', 'all_paths_failed', body.event_type ?? body.event, lastStatus);
  }
  return false;
}

/**
 * @param {string} eventType
 * @param {Record<string, unknown>} [meta]
 * @param {{ dedupeSuffix?: string; skipDedupe?: boolean }} [opts]
 */
export async function reportUserCenterEvent(eventType, meta = {}, opts = {}) {
  const type = String(eventType ?? '').trim();
  if (!type) return false;
  const dedupeSuffix = opts.dedupeSuffix ?? '';
  if (!opts.skipDedupe && shouldSkipDedupe(dedupeKey(type, dedupeSuffix))) return false;

  const envelope = await buildUserCenterDeviceEnvelope({
    event_type: type,
    event: type,
    ...meta,
  });

  return postFirstOk(
    ['/api/user-center/events', '/api/analytics/app-event', '/api/app-history'],
    envelope,
  );
}

/**
 * Login / app-open history for Admin User Center.
 */
export async function reportLoginHistory(meta = {}) {
  if (shouldSkipDedupe(dedupeKey('login', meta.install_instance_id ?? 'boot'))) return false;
  const envelope = await buildUserCenterDeviceEnvelope({
    event_type: 'app_open',
    event: 'app_open',
    login: true,
    ...meta,
  });
  return postFirstOk(
    ['/api/user-center/login', '/api/login-history', '/api/analytics/login'],
    envelope,
  );
}

/** App background / logout signal. */
export async function reportLogoutHistory(meta = {}) {
  const envelope = await buildUserCenterDeviceEnvelope({
    event_type: 'app_logout',
    event: 'app_logout',
    logout: true,
    ...meta,
  });
  return postFirstOk(
    ['/api/user-center/login', '/api/login-history', '/api/analytics/login'],
    envelope,
  );
}

/**
 * @param {'success'|'failure'|'timeout'|'cancelled'|'started'} status
 * @param {Record<string, unknown>} [meta]
 */
export async function reportPaymentTelemetry(status, meta = {}) {
  const s = String(status ?? '').trim().toLowerCase();
  const eventType =
    s === 'success'
      ? 'payment_success'
      : s === 'failure'
        ? 'payment_failed'
        : s === 'timeout'
          ? 'payment_timeout'
          : s === 'cancelled'
            ? 'payment_cancelled'
            : s === 'started'
              ? 'payment_started'
              : `payment_${s || 'unknown'}`;

  const envelope = await buildUserCenterDeviceEnvelope({
    event_type: eventType,
    event: eventType,
    payment_status: s,
    ...meta,
  });

  return postFirstOk(['/api/payments/events', '/api/user-center/events'], envelope);
}

/** Push full device snapshot to Admin User Center (boot + resume). */
export async function reportDeviceTelemetry(meta = {}) {
  if (shouldSkipDedupe(dedupeKey('device_telemetry', 'boot'))) return false;
  const envelope = await buildUserCenterDeviceEnvelope(meta);
  return postFirstOk(['/api/device/telemetry', '/api/users-intelligence/register'], envelope);
}

/**
 * Non-blocking boot sync: login history + device telemetry.
 * Call once from App.js after identity is ready.
 */
export function bootUserCenterSync() {
  void (async () => {
    try {
      await Promise.all([reportLoginHistory(), reportDeviceTelemetry()]);
    } catch (e) {
      console.log('[USER_CENTER_SYNC]', 'boot_failed', String(e?.message ?? e));
    }
  })();
}
