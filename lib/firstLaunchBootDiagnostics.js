/**
 * Runtime proof for embedded vs OTA bundle stream-direct routing capability.
 * Logs on every cold start; used to explain first-session vs second-session playback.
 */

import * as Updates from 'expo-updates';
import { DEFAULT_API_URL, LEGACY_API_HOSTS } from './apiBaseUrl';
import { isStreamDirectUrl, resolveMediaAssetUrl } from './mediaDelivery';
import { looksLikeHlsPlaybackUri } from './hlsPlayback';
import { isExpoUpdatesRuntimeEnabled } from './expoUpdatesClient';

/** Legacy Render URL — must rewrite to {@link DEFAULT_API_URL} in production bundles. */
const SAMPLE_STREAM_DIRECT = `${LEGACY_API_HOSTS[0]}/stream-direct?token=diagnostic`;

/**
 * Probe whether the running JS bundle CDN-rewrites stream-direct and routes to Exo.
 *
 * @returns {Record<string, unknown>}
 */
export function probeStreamDirectRoutingCapability() {
  const resolved = resolveMediaAssetUrl(SAMPLE_STREAM_DIRECT);
  const looksHls = looksLikeHlsPlaybackUri(resolved);
  return {
    hasStreamDirectExempt: typeof isStreamDirectUrl === 'function',
    sampleResolvedUrl: resolved,
    cdnRewritten: resolved.includes('144.91.117.90:10001'),
    looksLikeHlsPlaybackUri: looksHls,
    predictedBeinRoute: looksHls ? 'native' : 'embed-webview',
    staleEmbeddedLikely:
      /onrender\.com/i.test(resolved) ||
      (/b-cdn\.net\/stream-direct/i.test(resolved) && !looksHls),
    expectedApiHost: DEFAULT_API_URL,
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function collectFirstLaunchBootDiagnostics() {
  const routing = probeStreamDirectRoutingCapability();
  let updates = {
    enabled: isExpoUpdatesRuntimeEnabled(),
    isEmbeddedLaunch: null,
    updateId: null,
    runtimeVersion: null,
    channel: null,
  };
  if (updates.enabled) {
    try {
      updates = {
        enabled: true,
        isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
        updateId: Updates.updateId ?? null,
        runtimeVersion: Updates.runtimeVersion ?? null,
        channel: Updates.channel ?? null,
      };
    } catch (e) {
      updates.error = String(e?.message ?? e);
    }
  }
  return {
    at: Date.now(),
    updates,
    routing,
    firstSessionPlaybackRisk: routing.staleEmbeddedLikely === true || routing.hasStreamDirectExempt === false,
  };
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [data]
 */
export function logFirstLaunchBootDiagnostics(tag, data = {}) {
  try {
    console.log('[first-launch-boot]', tag, {
      ...collectFirstLaunchBootDiagnostics(),
      ...data,
    });
  } catch {
    /* ignore */
  }
}
