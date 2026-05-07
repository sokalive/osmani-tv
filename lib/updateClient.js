import { AppState, Platform } from 'react-native';
import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';

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

const DEBUG = true;
function log(...args) {
  if (!DEBUG) return;
  try {
    console.log('[update]', ...args);
  } catch {}
}

const RECHECK_DEBOUNCE_MS = 1500;
const RESUME_RECHECK_GUARD_MS = 30_000;
const SSE_RETRY_MS = 15_000;
const UPDATE_API_BASE_URL = `${BASE_URL.replace(/\/+$/, '')}/api`;
const SSE_ENDPOINTS = [
  `${UPDATE_API_BASE_URL}/sync/stream`,
  `${UPDATE_API_BASE_URL}/app-settings/stream`,
];

let listeners = new Set();
let nativeStateSub = null;
let appStateSub = null;
let sseSource = null;
let sseRetryTimer = null;
let started = false;
let lastCheckAt = 0;
let lastResumeCheckAt = 0;
let recheckDebounce = null;

let lastUpdateInfo = null;
let lastNativeState = { state: 'idle' };
let lastUiState = {
  decision: 'NONE',
  visible: false,
  downloading: false,
  verifying: false,
  installing: false,
  needsUnknownSourcesPermission: false,
  failedReason: null,
  progress: { downloaded: 0, total: 0, percent: -1 },
  info: null,
};

function isAndroidNativeAvailable() {
  return Platform.OS === 'android' && OsmaniUpdate != null;
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
}

function setUi(patch) {
  lastUiState = { ...lastUiState, ...patch };
  log('overlay state changed', {
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

function recomputeUiFromNative(nativeState) {
  lastNativeState = nativeState ?? { state: 'idle' };
  const next = {
    downloading: false,
    verifying: false,
    installing: false,
    needsUnknownSourcesPermission: false,
  };
  switch (lastNativeState.state) {
    case 'downloading':
      next.downloading = true;
      lastUiState.progress = {
        downloaded: lastNativeState.downloaded ?? 0,
        total: lastNativeState.total ?? 0,
        percent:
          typeof lastNativeState.percent === 'number' ? lastNativeState.percent : -1,
      };
      break;
    case 'verifying':
      next.verifying = true;
      break;
    case 'installing':
      next.installing = true;
      break;
    case 'needs_unknown_sources_permission':
      next.needsUnknownSourcesPermission = true;
      break;
    case 'failed':
      lastUiState.failedReason = lastNativeState.error ?? 'unknown_error';
      break;
    default:
      break;
  }
  setUi(next);
}

function applyUpdateInfo(info) {
  lastUpdateInfo = info;
  const decision = info?.decision ?? 'NONE';
  log('force/soft detection', {
    decision,
    source: info?.source,
    autoDownload: info?.autoDownload,
    hasDownloadUrl: Boolean(getDownloadUrl(info)),
    hasStoreUrl: Boolean(getStoreUrl(info)),
    notice: info?.notice,
  });
  setUi({
    decision,
    visible: shouldShowFor(decision),
    info,
    failedReason: null,
  });
}

async function performCheckOnce(reason) {
  if (!isAndroidNativeAvailable()) return null;
  const now = Date.now();
  if (now - lastCheckAt < RECHECK_DEBOUNCE_MS) return lastUpdateInfo;
  lastCheckAt = now;
  try {
    log('check →', reason, UPDATE_API_BASE_URL);
    const info = await OsmaniUpdate.checkForUpdate(UPDATE_API_BASE_URL);
    log('update-check response', info);
    applyUpdateInfo(info);

    if (
      (info?.decision === 'SOFT' || info?.decision === 'FORCE') &&
      info?.autoDownload === true &&
      getDownloadUrl(info) &&
      !lastUiState.downloading &&
      !lastUiState.installing
    ) {
      void startDownload();
    }
    return info;
  } catch (e) {
    log('check failed', e?.message ?? e);
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
  scheduleCheck('app-resume', 250);
}

function clearSseRetry() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
}

function disconnectSse() {
  clearSseRetry();
  if (sseSource) {
    try { sseSource.close(); } catch {}
    sseSource = null;
  }
}

function connectSse() {
  if (sseSource) return;
  const url = SSE_ENDPOINTS[0];
  let es;
  try {
    es = new EventSource(url, {
      headers: { Accept: 'text/event-stream' },
      timeout: 0,
    });
  } catch (e) {
    log('SSE construct failed', url, e?.message ?? e);
    sseRetryTimer = setTimeout(connectSse, SSE_RETRY_MS);
    return;
  }
  sseSource = es;
  log('SSE connecting →', url);

  const onChange = (label) => (event) => {
    log('SSE event', label, event?.data ? String(event.data).slice(0, 500) : '');
    scheduleCheck(`sse:${label}`, 200);
  };

  es.addEventListener('open', () => log('SSE open', url));
  es.addEventListener('app_version_changed', onChange('app_version_changed'));
  es.addEventListener('app_settings_changed', onChange('app_settings_changed'));
  es.addEventListener('sync', onChange('sync'));
  es.addEventListener('settings', onChange('settings'));
  es.addEventListener('app_version', onChange('app_version'));
  es.addEventListener('update', onChange('update'));
  es.addEventListener('message', (event) => {
    if (event?.data) log('SSE message', String(event.data).slice(0, 500));
    scheduleCheck('sse:message', 200);
  });
  es.addEventListener('error', (event) => {
    log('SSE error', url, event?.message ?? '(no message)');
    disconnectSse();
    sseRetryTimer = setTimeout(() => {
      // Always retry production first; app-settings stream remains a
      // legacy fallback inside native builds if the backend is rolled back.
      connectSse();
    }, SSE_RETRY_MS);
  });
}

export function startUpdateClient() {
  if (started) return;
  started = true;
  if (!isAndroidNativeAvailable()) {
    log('skipped — not android or native module unavailable');
    return;
  }

  nativeStateSub = OsmaniUpdate.addStateListener((nativeState) => {
    log('native state', nativeState?.state);
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
  disconnectSse();
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

export async function startDownload() {
  if (!isAndroidNativeAvailable()) return;
  const info = lastUpdateInfo;
  const downloadUrl = getDownloadUrl(info);
  if (!downloadUrl) {
    const storeUrl = getStoreUrl(info);
    if (storeUrl) {
      log('startDownload: apkUrl is a store URL; opening Play Store instead', storeUrl);
      await openPlayStoreFromInfo();
      return;
    }
    log('startDownload: missing APK download URL', info);
    setUi({ failedReason: 'missing_apk_url' });
    return;
  }
  if (lastUiState.downloading || lastUiState.installing) {
    log('startDownload: already in progress');
    return;
  }
  setUi({ failedReason: null });
  try {
    log('download requested', {
      apkUrl: downloadUrl,
      hasSha256: Boolean(info?.apkSha256),
      decision: info?.decision,
      source: info?.source,
    });
    const result = await OsmaniUpdate.downloadAndInstall(downloadUrl, info?.apkSha256 || null);
    log('install result', result?.status);
  } catch (e) {
    log('download/install failed', e?.message ?? e);
    setUi({ failedReason: e?.message ?? 'unknown_error' });
  }
}

export function cancelDownload() {
  if (!isAndroidNativeAvailable()) return;
  try { OsmaniUpdate.cancelDownload(); } catch {}
}

export function dismissSoft() {
  if (lastUiState.decision === 'FORCE') return;
  setUi({ visible: false });
}

export function quitForForceCancel() {
  if (!isAndroidNativeAvailable()) return;
  try { OsmaniUpdate.quitApp(); } catch {}
}

export async function openPlayStoreFromInfo() {
  if (!isAndroidNativeAvailable()) return;
  const url = getStoreUrl(lastUpdateInfo);
  if (!url) return;
  log('opening Play Store URL', url);
  try { await OsmaniUpdate.openPlayStore(url); } catch (e) {
    log('openPlayStore failed', e?.message ?? e);
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
