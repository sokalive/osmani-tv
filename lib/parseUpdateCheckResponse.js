/**
 * Normalizes production /api/update-check JSON into the shape expected by
 * lib/updateClient.js and the osmani-update native module.
 *
 * Version gate (authoritative):
 *   popup / force lock ONLY when installed_version_code < latest_version_code
 *   installed_version_code >= PUBLISHED_PLAY_VERSION_CODE → never show (Play v24+)
 * Admin SOFT/FORCE toggles never affect installs already on latest_version_code.
 */

/** Play Store production target — installs at or above this never see update UI. */
export const PUBLISHED_PLAY_VERSION_CODE = 24;

const DEFAULT_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.burudanitv.app';

function pickString(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k) || obj[k] == null) continue;
    const v = String(obj[k]).trim();
    if (v) return v;
  }
  return '';
}

function pickInt(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k) || obj[k] == null) continue;
    const n = Number(obj[k]);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function pickBool(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k) || obj[k] == null) continue;
    const v = obj[k];
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(t)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
    }
  }
  return null;
}

function normalizeDecision(raw) {
  const d = String(raw ?? 'NONE').trim().toUpperCase();
  if (d === 'SOFT') return 'SOFT';
  if (d === 'FORCE' || d === 'FORCED' || d === 'HARD') return 'FORCE';
  if (d === 'PLAY_STORE' || d === 'PLAYSTORE' || d === 'STORE') return 'PLAY_STORE';
  return 'NONE';
}

function isPlayStoreUrl(url) {
  const s = String(url ?? '').trim().toLowerCase();
  return s.includes('play.google.com/') || s.startsWith('market://');
}

/** Published target from update-check body (latest_version_code, else response version_code). */
export function latestVersionCodeFromBody(body) {
  if (!body || typeof body !== 'object') return 0;
  let latest = pickInt(
    body,
    'latest_version_code',
    'latestVersionCode',
    'target_version_code',
    'targetVersionCode',
    'published_version_code',
    'publishedVersionCode',
  );
  if (latest <= 0) {
    latest = pickInt(body, 'version_code', 'versionCode');
  }
  return latest > 0 ? latest : 0;
}

/** True only when install is strictly below the published latest_version_code. */
export function isOutdated(installedVersionCode, latestVersionCode) {
  const installed = Number(installedVersionCode ?? 0);
  const latest = Number(latestVersionCode ?? 0);
  if (!Number.isFinite(installed) || !Number.isFinite(latest)) return false;
  if (installed <= 0 || latest <= 0) return false;
  return installed < latest;
}

/**
 * Hard gate: installs on latest_version_code never see SOFT/FORCE/PLAY_STORE UI,
 * regardless of admin toggles or global backend decision.
 */
export function applyVersionGate(info) {
  if (!info || typeof info !== 'object') return info;
  const installed = Number(info.installedVersionCode ?? info.installed_version_code ?? 0);
  const latest = Number(
    info.latestVersionCode ?? info.latest_version_code ?? info.serverVersionCodeTarget ?? 0,
  );
  if (Number.isFinite(installed) && installed >= PUBLISHED_PLAY_VERSION_CODE) {
    const raw = info.decision ?? 'NONE';
    if (raw !== 'NONE') {
      return {
        ...info,
        decision: 'NONE',
        updateSuppressed: true,
        rawDecision: raw,
        latestVersionCode: Math.max(latest, PUBLISHED_PLAY_VERSION_CODE),
        serverVersionCodeTarget: Math.max(latest, PUBLISHED_PLAY_VERSION_CODE),
      };
    }
    return info;
  }
  if (latest <= 0 || !Number.isFinite(installed) || installed <= 0) return info;
  if (installed >= latest) {
    const raw = info.decision ?? 'NONE';
    if (raw !== 'NONE') {
      return {
        ...info,
        decision: 'NONE',
        updateSuppressed: true,
        rawDecision: raw,
        latestVersionCode: latest,
        serverVersionCodeTarget: latest,
      };
    }
  }
  return info;
}

/**
 * @param {Record<string, unknown>} body Raw update-check JSON
 * @param {{ installedVersionCode?: number, requestVersionCode?: number }} ctx
 * @returns {Record<string, unknown> | null}
 */
export function parseUpdateCheckResponse(body, ctx = {}) {
  if (!body || typeof body !== 'object') return null;

  const installed = pickInt(
    { installed_version_code: ctx.installedVersionCode },
    'installed_version_code',
  );
  const requestVersion = pickInt(
    { request_version_code: ctx.requestVersionCode },
    'request_version_code',
  );

  const latestVersionCode = latestVersionCodeFromBody(body);

  const minSupportedVersionCode = pickInt(
    body,
    'min_supported_version_code',
    'minSupportedVersionCode',
    'min_version_code',
    'minVersionCode',
  );

  const apkUrl = pickString(body, 'apk_url', 'apkUrl', 'download_url', 'downloadUrl');
  const playStoreUrl = pickString(
    body,
    'play_store_url',
    'playStoreUrl',
    'playstore_url',
    'playstoreUrl',
  );
  const apkUrlIsStore = isPlayStoreUrl(apkUrl);

  const title = pickString(
    body,
    'title',
    'update_title',
    'updateTitle',
    'heading',
  );
  const notice = pickString(
    body,
    'notice',
    'message',
    'update_message',
    'updateMessage',
    'update_notice',
    'updateNotice',
    'body',
  );

  let decision = normalizeDecision(
    pickString(body, 'decision', 'update_decision', 'updateDecision'),
  );

  const forceFlag = pickBool(
    body,
    'force_update',
    'forceUpdate',
    'force_update_enabled',
    'forceUpdateEnabled',
    'forced',
  );
  const softFlag = pickBool(
    body,
    'soft_update',
    'softUpdate',
    'soft_update_enabled',
    'softUpdateEnabled',
  );
  const updateMode = pickString(body, 'update_mode', 'updateMode', 'mode').toLowerCase();

  const installedForCompare =
    installed > 0 ? installed : requestVersion > 0 ? requestVersion : 0;
  const outdated = isOutdated(installedForCompare, latestVersionCode);

  const hasApkDelivery = Boolean(apkUrl) && !apkUrlIsStore;
  const hasStoreDelivery = Boolean(playStoreUrl) || apkUrlIsStore;
  const source = pickString(body, 'source', 'update_source', 'updateSource').toLowerCase();

  const adminUpdateEnabled =
    forceFlag === true ||
    softFlag === true ||
    updateMode === 'force' ||
    updateMode === 'soft' ||
    decision === 'FORCE' ||
    decision === 'SOFT' ||
    decision === 'PLAY_STORE';

  // Never derive or honor update UI when already on latest.
  if (!outdated) {
    decision = 'NONE';
  } else if (decision === 'NONE') {
    if (forceFlag === true || updateMode === 'force') {
      decision = 'FORCE';
    } else if (softFlag === true || updateMode === 'soft') {
      decision = 'SOFT';
    } else if (adminUpdateEnabled && source === 'play' && hasStoreDelivery) {
      decision = 'PLAY_STORE';
    } else if (adminUpdateEnabled && hasApkDelivery) {
      decision = 'SOFT';
    } else if (adminUpdateEnabled && hasStoreDelivery) {
      decision = 'PLAY_STORE';
    } else if (adminUpdateEnabled && (source === 'apk' || source === '')) {
      decision = 'SOFT';
    }
  }

  const result = {
    decision,
    latestVersionCode,
    latest_version_code: latestVersionCode,
    latestVersionName: pickString(
      body,
      'latest_version_name',
      'latestVersionName',
      'version_name',
      'versionName',
    ),
    minSupportedVersionCode,
    min_supported_version_code: minSupportedVersionCode,
    autoDownload: pickBool(body, 'auto_download', 'autoDownload') === true,
    auto_download: pickBool(body, 'auto_download', 'autoDownload') === true,
    apkUrl: apkUrlIsStore ? '' : apkUrl,
    apk_url: apkUrlIsStore ? '' : apkUrl,
    apkSha256: pickString(body, 'apk_sha256', 'apkSha256', 'sha256').toLowerCase(),
    apk_sha256: pickString(body, 'apk_sha256', 'apkSha256', 'sha256').toLowerCase(),
    apkSizeBytes: pickInt(body, 'apk_size_bytes', 'apkSizeBytes'),
    playStoreUrl: playStoreUrl || (apkUrlIsStore ? apkUrl : '') || DEFAULT_PLAY_STORE_URL,
    play_store_url: playStoreUrl || (apkUrlIsStore ? apkUrl : '') || DEFAULT_PLAY_STORE_URL,
    playstore_url: playStoreUrl || (apkUrlIsStore ? apkUrl : '') || DEFAULT_PLAY_STORE_URL,
    releaseNotes: pickString(body, 'release_notes', 'releaseNotes'),
    notice,
    title,
    source: source || (hasStoreDelivery ? 'play' : hasApkDelivery ? 'apk' : ''),
    installedVersionCode: installedForCompare,
    serverVersionCodeTarget: latestVersionCode,
  };

  return applyVersionGate(result);
}

export function mergeUpdateInfo(nativeInfo, normalized) {
  if (!normalized) return nativeInfo;
  const base = nativeInfo && typeof nativeInfo === 'object' ? { ...nativeInfo } : {};
  const merged = { ...base, ...normalized };
  if (!merged.title && normalized.title) merged.title = normalized.title;
  if (!merged.notice && normalized.notice) merged.notice = normalized.notice;

  const installed = Number(merged.installedVersionCode ?? merged.installed_version_code ?? 0);
  const latest = Number(merged.latestVersionCode ?? merged.latest_version_code ?? 0);
  const outdated = isOutdated(installed, latest);

  if (
    outdated &&
    (base.decision === 'NONE' || !base.decision) &&
    normalized.decision &&
    normalized.decision !== 'NONE'
  ) {
    merged.decision = normalized.decision;
    merged.decisionRecovered = true;
  }

  return applyVersionGate(merged);
}
