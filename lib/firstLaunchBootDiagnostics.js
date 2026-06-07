/**
 * Runtime proof for embedded vs OTA bundle stream-direct routing capability.
 * Logs on every cold start; used to explain first-session vs second-session playback.
 */

import * as Updates from 'expo-updates';
import { isStreamDirectUrl, resolveMediaAssetUrl } from './mediaDelivery';
import { looksLikeHlsPlaybackUri } from './hlsPlayback';
import { isExpoUpdatesRuntimeEnabled } from './expoUpdatesClient';

const SAMPLE_STREAM_DIRECT =
  'https://osmani-admin-api.onrender.com/stream-direct?token=diagnostic';

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
    cdnRewritten: /b-cdn\.net\/stream-direct/i.test(resolved),
    looksLikeHlsPlaybackUri: looksHls,
    predictedBeinRoute: looksHls ? 'native' : 'embed-webview',
    staleEmbeddedLikely: /b-cdn\.net\/stream-direct/i.test(resolved) && !looksHls,
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
    firstSessionPlaybackRisk:
      updates.isEmbeddedLaunch === true && routing.staleEmbeddedLikely === true,
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
