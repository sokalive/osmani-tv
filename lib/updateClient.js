import { AppState, Platform } from 'react-native';
import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';
import {
  getRemoteApkInstallerState,
  isApkSideloadInstallEnabled,
  isApkUpdateCheckEnabled,
} from './apkInstallerConfig';
import { tryGetRemoteApkInstallerSettings } from '../api/apkInstallerSettings';
import {
  applyVersionGate,
  isOutdated,
  mergeUpdateInfo,
  parseUpdateCheckResponse,
} from './parseUpdateCheckResponse';

let OsmaniUpdate = null;

if (Platform.OS === 'android') {
  try {
    OsmaniUpdate = require('../modules/osmani-update');
  } catch (e) {
    if (__DEV__) {
      console.warn('[update] native module unavailable:', e?.message ?? e);
    }
    OsmaniUpdate = null;
  }
}

const DEBUG = __DEV__;
const PREFIX = '[update]';

function log(tag, ...args) {
  if (!DEBUG) return;
  try {
    console.log(PREFIX, tag, ...args);
  } catch {}
}

function warn(tag, ...args) {
  try {
    console.warn(PREFIX, tag, ...args);
  } catch {}
}

const RECHECK_DEBOUNCE_MS = 1500;
const RESUME_RECHECK_GUARD_MS = 60_000;
const SSE_RETRY_MS = 15_000;
const UPDATE_API_BASE_URL = `${BASE_URL.replace(/\/+$/, '')}/api`;
/** Legacy package id before Play Store applicationId migration (admin DB may still key on this). */
const LEGACY_ANDROID_PACKAGE = 'com.osmantv.app';
const SSE_ENDPOINTS = [
  `${UPDATE_API_BASE_URL}/sync/stream`,
  `${UPDATE_API_BASE_URL}/app-settings/stream`,
];
const DEBUG_ENDPOINT_URL = `${UPDATE_API_BASE_URL}/update-debug`;

let listeners = new Set();
let debugListeners = new Set();
let nativeStateSub = null;
let appStateSub = null;
let sseSource = null;
let sseRetryTimer = null;
let started = false;
let lastCheckAt = 0;
let lastResumeCheckAt = 0;
let lastCheckRequestUrlBase = null;
let lastCheckError = null;
let lastSseOpenAt = 0;
let lastSseEventAt = 0;
let lastSseError = null;
let sseConnected = false;
let sseActiveUrl = null;
let sseAttemptIndex = 0;
let recheckDebounce = null;

let lastUpdateInfo = null;
let lastUpdateInfoAt = 0;
let lastNativeState = { state: 'idle' };
let lastUiState = {
  decision: 'NONE',
  visible: false,
  checking: false,
  downloading: false,
  verifying: false,
  downloaded: false,
  installing: false,
  needsUnknownSourcesPermission: false,
  failedReason: null,
  progress: { downloaded: 0, total: 0, percent: -1 },
  info: null,
};

function isUpdateNativeModuleAvailable() {
  return Platform.OS === 'android' && OsmaniUpdate != null;
}

function isAndroidNativeAvailable() {
  return (
    isApkUpdateCheckEnabled() &&
    isUpdateNativeModuleAvailable()
  );
}

function isSideloadInstallReady() {
  return isUpdateNativeModuleAvailable() && isApkSideloadInstallEnabled();
}

function isPlayStoreUrl(url) {
  const s = String(url ?? '').trim().toLowerCase();
  return s.includes('play.google.com/') || s.startsWith('market://');
}

function getStoreUrl(info) {
  const direct = String(info?.playStoreUrl ?? '').trim();
  if (direct) return direct;
  const apkUrl = String(info?.apkUrl ?? '').trim();
  return isPlayStoreUrl(apkUrl) ? apkUrl : '';
}

function getDownloadUrl(info) {
  const url = String(info?.apkUrl ?? '').trim();
  if (!url || isPlayStoreUrl(url)) return '';
  return url;
}

function notify() {
  for (const cb of listeners) {
    try { cb(lastUiState); } catch {}
  }
  notifyDebug();
}

function notifyDebug() {
  if (debugListeners.size === 0) return;
  const snapshot = getDebugSnapshot();
  for (const cb of debugListeners) {
    try { cb(snapshot); } catch {}
  }
}

function setUi(patch) {
  lastUiState = { ...lastUiState, ...patch };
  log('[OVERLAY]', {
    decision: lastUiState.decision,
    visible: lastUiState.visible,
    downloading: lastUiState.downloading,
    verifying: lastUiState.verifying,
    installing: lastUiState.installing,
    needsUnknownSourcesPermission: lastUiState.needsUnknownSourcesPermission,
    failedReason: lastUiState.failedReason,
    progress: lastUiState.progress,
  });
  notify();
}

function shouldShowFor(decision) {
  return decision === 'SOFT' || decision === 'FORCE' || decision === 'PLAY_STORE';
}

/** Published target — latest_version_code only (admin toggles must not affect current latest). */
function latestVersionCodeTarget(info) {
  const latest = Number(
    info?.latestVersionCode ??
      info?.latest_version_code ??
      info?.serverVersionCodeTarget ??
      0,
  );
  return Number.isFinite(latest) && latest > 0 ? latest : 0;
}

/** Suppress update UI when installed_version_code >= latest_version_code. */
function normalizeUpdateInfo(info) {
  return applyVersionGate(info);
}

async function fetchUpdateCheckJson(installedVersionCode, packageName) {
  const base = UPDATE_API_BASE_URL.replace(/\/+$/, '');
  const qs = new URLSearchParams({
    platform: 'android',
    package: packageName,
    version_code: String(installedVersionCode || 0),
    version_name: '1.0.0',
  });
  const url = `${base}/update-check?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'OsmaniTV-Updater/1.0 (JS)' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = await res.json();
  return { url, body };
}

/**
 * JS-side normalization + legacy package retry. Works on existing APKs without a
 * native rebuild when production returns admin-panel field names.
 */
async function enrichUpdateInfoFromApi(nativeInfo) {
  if (!isUpdateNativeModuleAvailable()) return nativeInfo;
  let installed = Number(
    nativeInfo?.installedVersionCode ?? nativeInfo?.installed_version_code ?? 0,
  );
  if (!Number.isFinite(installed) || installed <= 0) {
    try {
      const v = OsmaniUpdate.getInstalledVersion();
      installed = Number(v?.versionCode ?? 0);
    } catch {
      installed = 0;
    }
  }

  const packages = [];
  try {
    const primary = OsmaniUpdate.PACKAGE_NAME || '';
    if (primary) packages.push(primary);
  } catch {
    /* ignore */
  }
  if (!packages.includes(LEGACY_ANDROID_PACKAGE)) {
    packages.push(LEGACY_ANDROID_PACKAGE);
  }

  let best = nativeInfo;
  for (const pkg of packages) {
    try {
      const { url, body } = await fetchUpdateCheckJson(installed, pkg);
      const normalized = parseUpdateCheckResponse(body, {
        installedVersionCode: installed,
        requestVersionCode: installed,
      });
      const merged = mergeUpdateInfo(best, normalized);
      log('[CHECK_ENRICH]', {
        package: pkg,
        url,
        rawDecision: body?.decision,
        normalizedDecision: normalized?.decision,
        mergedDecision: merged?.decision,
        latestVersionCode: merged?.latestVersionCode,
        hasApk: Boolean(getDownloadUrl(merged)),
      });
      best = merged;
      if (shouldShowFor(merged?.decision)) break;
    } catch (e) {
      warn('[CHECK_ENRICH]', 'failed', pkg, e?.message ?? e);
    }
  }
  return best;
}

/**
 * Pure JS update-check when native HTTP fails (OTA-safe for Play v17+).
 */
async function performJsOnlyUpdateCheck(reason) {
  if (!isUpdateNativeModuleAvailable()) return null;
  let installed = 0;
  try {
    const v = OsmaniUpdate.getInstalledVersion();
    installed = Number(v?.versionCode ?? 0);
  } catch {
    installed = 0;
  }
  log('[CHECK_REQ]', { reason, mode: 'js_fallback', installed });
  const enriched = await enrichUpdateInfoFromApi({ installedVersionCode: installed });
  if (!enriched) return null;
  const info = normalizeUpdateInfo(enriched);
  lastCheckError = null;
  applyUpdateInfo(info);
  log('[CHECK_RESP]', 'js_fallback', info);
  notifyDebug();
  return info;
}

function recomputeUiFromNative(nativeState) {
  lastNativeState = nativeState ?? { state: 'idle' };
  const next = {
    checking: false,
    downloading: false,
    verifying: false,
    downloaded: false,
    installing: false,
    needsUnknownSourcesPermission: false,
  };
  switch (lastNativeState.state) {
    case 'checking':
      next.checking = true;
      lastUiState.failedReason = null;
      log('[CHECK]', 'in_progress');
      break;
    case 'downloading':
      next.downloading = true;
      lastUiState.failedReason = null;
      lastUiState.progress = {
        downloaded: lastNativeState.downloaded ?? 0,
        total: lastNativeState.total ?? 0,
        percent:
          typeof lastNativeState.percent === 'number' ? lastNativeState.percent : -1,
      };
      log('[DOWNLOAD]', 'progress', lastUiState.progress);
      break;
    case 'verifying':
      next.verifying = true;
      lastUiState.failedReason = null;
      log('[DOWNLOAD]', 'verifying');
      break;
    case 'downloaded':
      next.downloaded = true;
      lastUiState.failedReason = null;
      log('[DOWNLOAD]', 'complete', { filePath: lastNativeState.filePath });
      break;
    case 'installing':
      next.installing = true;
      log('[INSTALL]', 'launching system installer', { filePath: lastNativeState.filePath });
      break;
    case 'needs_unknown_sources_permission':
      next.needsUnknownSourcesPermission = true;
      log('[INSTALL]', 'needs_unknown_sources_permission');
      break;
    case 'failed':
      lastUiState.failedReason = lastNativeState.error ?? 'unknown_error';
      warn('[INSTALL]', 'failed', lastUiState.failedReason);
      break;
    case 'idle':
      lastUiState.failedReason = null;
      break;
    default:
      break;
  }
  setUi(next);
}

function applyUpdateInfo(info) {
  const gated = applyVersionGate(info);
  lastUpdateInfo = gated;
  lastUpdateInfoAt = Date.now();
  const decision = gated?.decision ?? 'NONE';
  const installed = Number(gated?.installedVersionCode ?? gated?.installed_version_code ?? 0);
  const latest = latestVersionCodeTarget(gated);
  const outdated = isOutdated(installed, latest);
  const visible = shouldShowFor(decision) && outdated;
  const tag =
    decision === 'FORCE'
      ? '[FORCE]'
      : decision === 'SOFT'
        ? '[SOFT]'
        : decision === 'PLAY_STORE'
          ? '[PLAY_STORE]'
          : '[NONE]';
  log(tag, 'detected', {
    decision,
    outdated,
    installedVersionCode: installed,
    latestVersionCode: latest,
    source: gated?.source,
    autoDownload: gated?.autoDownload,
    hasDownloadUrl: Boolean(getDownloadUrl(gated)),
    hasStoreUrl: Boolean(getStoreUrl(gated)),
    notice: gated?.notice,
    latestVersionName: gated?.latestVersionName,
    updateSuppressed: Boolean(gated?.updateSuppressed),
  });
  setUi({
    decision,
    visible,
    info: gated,
    failedReason: null,
  });
}

async function performCheckOnce(reason) {
  if (!isAndroidNativeAvailable()) return null;
  const now = Date.now();
  if (now - lastCheckAt < RECHECK_DEBOUNCE_MS) return lastUpdateInfo;
  lastCheckAt = now;
  lastCheckRequestUrlBase = UPDATE_API_BASE_URL;
  log('[CHECK_REQ]', { reason, base: UPDATE_API_BASE_URL });
  notifyDebug();
  try {
    const raw = await OsmaniUpdate.checkForUpdate(UPDATE_API_BASE_URL);
    const enriched = await enrichUpdateInfoFromApi(raw);
    const info = normalizeUpdateInfo(enriched);
    lastCheckError = null;
    log('[CHECK_RESP]', info);
    if (info?.decision === 'NONE' && (lastUiState.downloading || lastUiState.downloaded)) {
      cancelDownload();
    }
    applyUpdateInfo(info);

    if (
      isSideloadInstallReady() &&
      (info?.decision === 'SOFT' || info?.decision === 'FORCE') &&
      info?.autoDownload === true &&
      getDownloadUrl(info) &&
      !lastUiState.downloading &&
      !lastUiState.downloaded &&
      !lastUiState.installing
    ) {
      void startDownload();
    }
    return info;
  } catch (e) {
    lastCheckError = e?.message ?? String(e ?? 'unknown_error');
    warn('[CHECK_RESP]', 'native_failed', lastCheckError);
    try {
      const fallback = await performJsOnlyUpdateCheck(`${reason}:native_fallback`);
      if (fallback) return fallback;
    } catch (jsErr) {
      warn('[CHECK_RESP]', 'js_fallback_failed', jsErr?.message ?? jsErr);
    }
    notifyDebug();
    return null;
  }
}

function scheduleCheck(reason, delayMs = 0) {
  if (recheckDebounce) {
    clearTimeout(recheckDebounce);
    recheckDebounce = null;
  }
  if (delayMs <= 0) {
    void performCheckOnce(reason);
    return;
  }
  recheckDebounce = setTimeout(() => {
    recheckDebounce = null;
    void performCheckOnce(reason);
  }, delayMs);
}

function handleAppState(state) {
  if (state !== 'active') return;
  const now = Date.now();
  if (now - lastResumeCheckAt < RESUME_RECHECK_GUARD_MS) return;
  lastResumeCheckAt = now;
  void tryGetRemoteApkInstallerSettings().catch(() => null);
  scheduleCheck('app-resume', 250);
}

function clearSseRetry() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
}

function disconnectSse(reason) {
  clearSseRetry();
  if (sseSource) {
    try { sseSource.close(); } catch {}
    sseSource = null;
  }
  if (sseConnected) {
    log('[SSE_DISCONNECTED]', { url: sseActiveUrl, reason: reason ?? 'manual' });
  }
  sseConnected = false;
  notifyDebug();
}

function connectSse() {
  if (sseSource) return;
  const url = SSE_ENDPOINTS[sseAttemptIndex % SSE_ENDPOINTS.length];
  sseAttemptIndex += 1;
  sseActiveUrl = url;
  let es;
  try {
    es = new EventSource(url, {
      headers: { Accept: 'text/event-stream' },
      timeout: 0,
    });
  } catch (e) {
    lastSseError = e?.message ?? String(e ?? 'unknown_error');
    warn('[SSE_DISCONNECTED]', 'construct_failed', { url, error: lastSseError });
    sseRetryTimer = setTimeout(connectSse, SSE_RETRY_MS);
    notifyDebug();
    return;
  }
  sseSource = es;
  log('[SSE_CONNECTING]', url);
  notifyDebug();

  const onChange = (label) => (event) => {
    lastSseEventAt = Date.now();
    log('[SSE_EVENT]', label, event?.data ? String(event.data).slice(0, 500) : '');
    notifyDebug();
    scheduleCheck(`sse:${label}`, 200);
  };

  es.addEventListener('open', () => {
    sseConnected = true;
    lastSseOpenAt = Date.now();
    lastSseError = null;
    log('[SSE_CONNECTED]', { url });
    notifyDebug();
  });
  es.addEventListener('app_version_changed', onChange('app_version_changed'));
  es.addEventListener('app_settings_changed', onChange('app_settings_changed'));
  es.addEventListener('sync', onChange('sync'));
  es.addEventListener('settings', onChange('settings'));
  es.addEventListener('app_version', onChange('app_version'));
  es.addEventListener('update', onChange('update'));
  es.addEventListener('message', (event) => {
    lastSseEventAt = Date.now();
    if (event?.data) log('[SSE_EVENT]', 'message', String(event.data).slice(0, 500));
    notifyDebug();
    scheduleCheck('sse:message', 200);
  });
  es.addEventListener('error', (event) => {
    lastSseError = event?.message ?? '(no message)';
    warn('[SSE_DISCONNECTED]', 'error', { url, error: lastSseError });
    sseConnected = false;
    notifyDebug();
    disconnectSse('error');
    sseRetryTimer = setTimeout(() => {
      connectSse();
    }, SSE_RETRY_MS);
  });
}

export function startUpdateClient() {
  if (started) return;
  started = true;
  log('[OTA_INIT]', {
    platform: Platform.OS,
    nativeAvailable: isAndroidNativeAvailable(),
    base: UPDATE_API_BASE_URL,
    sseEndpoints: SSE_ENDPOINTS,
    debugEndpoint: DEBUG_ENDPOINT_URL,
  });
  if (!isAndroidNativeAvailable()) {
    log('[OTA_INIT]', 'skipped — not android or native module unavailable', {
      updateCheckEnabled: isApkUpdateCheckEnabled(),
      sideloadInstallEnabled: isApkSideloadInstallEnabled(),
    });
    notifyDebug();
    return;
  }

  void tryGetRemoteApkInstallerSettings().catch(() => null);

  nativeStateSub = OsmaniUpdate.addStateListener((nativeState) => {
    log('[NATIVE_STATE]', nativeState);
    recomputeUiFromNative(nativeState);
  });

  appStateSub = AppState.addEventListener('change', handleAppState);

  scheduleCheck('app-launch', 0);
  connectSse();
}

export function stopUpdateClient() {
  if (!started) return;
  started = false;
  if (nativeStateSub) {
    try { nativeStateSub.remove(); } catch {}
    nativeStateSub = null;
  }
  if (appStateSub) {
    try { appStateSub.remove(); } catch {}
    appStateSub = null;
  }
  disconnectSse('client-stop');
  if (recheckDebounce) {
    clearTimeout(recheckDebounce);
    recheckDebounce = null;
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  try { listener(lastUiState); } catch {}
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeDebug(listener) {
  debugListeners.add(listener);
  try { listener(getDebugSnapshot()); } catch {}
  return () => {
    debugListeners.delete(listener);
  };
}

export async function startDownload() {
  if (!isSideloadInstallReady()) {
    const storeUrl = getStoreUrl(lastUpdateInfo);
    if (storeUrl) await openPlayStoreFromInfo();
    return;
  }
  const info = lastUpdateInfo;
  const downloadUrl = getDownloadUrl(info);
  if (!downloadUrl) {
    const storeUrl = getStoreUrl(info);
    if (storeUrl) {
      log('[DOWNLOAD]', 'apkUrl is a store URL; opening Play Store instead', storeUrl);
      await openPlayStoreFromInfo();
      return;
    }
    warn('[DOWNLOAD]', 'missing APK download URL', info);
    setUi({ failedReason: 'missing_apk_url' });
    return;
  }
  if (lastUiState.downloading || lastUiState.verifying || lastUiState.installing) {
    log('[DOWNLOAD]', 'already in progress');
    return;
  }
  setUi({ failedReason: null, downloaded: false });
  try {
    log('[DOWNLOAD]', 'requested', {
      apkUrl: downloadUrl,
      hasSha256: Boolean(info?.apkSha256),
      decision: info?.decision,
      source: info?.source,
    });
    const result = await OsmaniUpdate.downloadAndInstall(downloadUrl, info?.apkSha256 || null);
    log('[DOWNLOAD]', 'result', result?.status);
  } catch (e) {
    warn('[DOWNLOAD]', 'failed', e?.message ?? e);
    setUi({ failedReason: e?.message ?? 'unknown_error', downloaded: false });
  }
}

export async function launchInstaller() {
  if (!isSideloadInstallReady()) return;
  if (lastUiState.installing) return;
  setUi({ failedReason: null, needsUnknownSourcesPermission: false });
  try {
    log('[INSTALL]', 'launch requested');
    const result = await OsmaniUpdate.launchInstaller();
    log('[INSTALL]', 'result', result?.status);
    if (result?.status === 'needs_unknown_sources_permission') {
      setUi({ needsUnknownSourcesPermission: true });
    }
  } catch (e) {
    warn('[INSTALL]', 'failed', e?.message ?? e);
    setUi({ failedReason: e?.message ?? 'unknown_error' });
  }
}

export function cancelDownload() {
  if (!isUpdateNativeModuleAvailable()) return;
  log('[DOWNLOAD]', 'cancel requested');
  try { OsmaniUpdate.cancelDownload(); } catch {}
}

export function dismissSoft() {
  if (lastUiState.decision === 'FORCE') return;
  setUi({ visible: false });
}

export function quitForForceCancel() {
  if (!isAndroidNativeAvailable()) return;
  log('[FORCE]', 'quit requested by user');
  try { OsmaniUpdate.quitApp(); } catch {}
}

export async function openPlayStoreFromInfo() {
  if (!isUpdateNativeModuleAvailable()) return;
  const url = getStoreUrl(lastUpdateInfo);
  if (!url) return;
  log('[PLAY_STORE]', 'opening', url);
  try { await OsmaniUpdate.openPlayStore(url); } catch (e) {
    warn('[PLAY_STORE]', 'open failed', e?.message ?? e);
  }
}

export function getUpdateAction(info = lastUpdateInfo) {
  return {
    downloadUrl: getDownloadUrl(info),
    storeUrl: getStoreUrl(info),
    canDownload: Boolean(getDownloadUrl(info)),
    canOpenStore: Boolean(getStoreUrl(info)),
  };
}

export function getCurrentState() {
  return lastUiState;
}

export function isNativeAvailable() {
  return isAndroidNativeAvailable();
}

export async function forceRecheck() {
  lastCheckAt = 0;
  return performCheckOnce('manual');
}

/**
 * Snapshot of every piece of OTA state needed to render the
 * mobile-side debug overlay. Always safe to call (returns plain JSON).
 */
export function getDebugSnapshot() {
  return {
    base: UPDATE_API_BASE_URL,
    sseEndpoints: SSE_ENDPOINTS,
    debugEndpoint: DEBUG_ENDPOINT_URL,
    started,
    nativeAvailable: isAndroidNativeAvailable(),
    platform: Platform.OS,
    decision: lastUiState.decision,
    overlayVisible: lastUiState.visible,
    overlayState: {
      checking: lastUiState.checking,
      downloading: lastUiState.downloading,
      verifying: lastUiState.verifying,
      downloaded: lastUiState.downloaded,
      installing: lastUiState.installing,
      needsUnknownSourcesPermission: lastUiState.needsUnknownSourcesPermission,
      failedReason: lastUiState.failedReason,
      progress: lastUiState.progress,
    },
    info: lastUpdateInfo,
    lastUpdateInfoAt,
    lastCheckAt,
    lastResumeCheckAt,
    lastCheckRequestUrlBase,
    lastCheckError,
    sse: {
      connected: sseConnected,
      url: sseActiveUrl,
      attemptIndex: sseAttemptIndex,
      lastOpenAt: lastSseOpenAt,
      lastEventAt: lastSseEventAt,
      lastError: lastSseError,
    },
    native: {
      available: isAndroidNativeAvailable(),
      sideloadReady: isSideloadInstallReady(),
      state: lastNativeState,
    },
    apkInstaller: getRemoteApkInstallerState(),
    derived: {
      ...getUpdateAction(lastUpdateInfo),
      serverVersionCodeTarget: latestVersionCodeTarget(lastUpdateInfo),
      updateSuppressed: Boolean(lastUpdateInfo?.updateSuppressed),
      rawDecision: lastUpdateInfo?.rawDecision ?? null,
    },
  };
}

export const UPDATE_DEBUG_ENDPOINT_URL = DEBUG_ENDPOINT_URL;
