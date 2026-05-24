/**
 * Normalizes production /api/update-check JSON into the shape expected by
 * lib/updateClient.js and the osmani-update native module.
 *
 * The admin API sometimes returns admin-panel field names (version_code,
 * update_title, update_message) without latest_version_code or a computed
 * decision. This layer restores the previously working client behavior
 * without changing backend architecture.
 */

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

  let latestVersionCode = pickInt(
    body,
    'latest_version_code',
    'latestVersionCode',
    'target_version_code',
    'targetVersionCode',
    'published_version_code',
    'publishedVersionCode',
  );
  const responseVersionCode = pickInt(body, 'version_code', 'versionCode');
  if (latestVersionCode <= 0 && responseVersionCode > 0) {
    // Admin API uses version_code for the published APK target in responses.
    latestVersionCode = responseVersionCode;
  }

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

  const serverTarget =
    latestVersionCode > 0
      ? latestVersionCode
      : minSupportedVersionCode > 0
        ? minSupportedVersionCode
        : 0;

  const installedForCompare =
    installed > 0 ? installed : requestVersion > 0 ? requestVersion : 0;
  const outdated =
    serverTarget > 0 &&
    installedForCompare > 0 &&
    installedForCompare < serverTarget;

  const hasApkDelivery = Boolean(apkUrl) && !apkUrlIsStore;
  const hasStoreDelivery = Boolean(playStoreUrl) || apkUrlIsStore;
  const source = pickString(body, 'source', 'update_source', 'updateSource').toLowerCase();

  if (decision === 'NONE' && outdated) {
    if (forceFlag === true || updateMode === 'force') {
      decision = 'FORCE';
    } else if (softFlag === true || updateMode === 'soft') {
      decision = 'SOFT';
    } else if (source === 'play' && hasStoreDelivery) {
      decision = 'PLAY_STORE';
    } else if (hasApkDelivery) {
      decision = forceFlag === false && softFlag !== true ? 'SOFT' : 'SOFT';
    } else if (hasStoreDelivery) {
      decision = 'PLAY_STORE';
    } else if (source === 'apk' || source === '') {
      // Production admin-api may publish target version_code + source=apk but omit
      // decision/apk_url until upload completes; still surface soft prompt for outdated installs.
      decision = 'SOFT';
    }
  }

  if (
    decision !== 'NONE' &&
    serverTarget > 0 &&
    installedForCompare > 0 &&
    installedForCompare >= serverTarget
  ) {
    decision = 'NONE';
  }

  return {
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
    playStoreUrl: playStoreUrl || (apkUrlIsStore ? apkUrl : ''),
    play_store_url: playStoreUrl || (apkUrlIsStore ? apkUrl : ''),
    playstore_url: playStoreUrl || (apkUrlIsStore ? apkUrl : ''),
    releaseNotes: pickString(body, 'release_notes', 'releaseNotes'),
    notice,
    title,
    source: source || (hasStoreDelivery ? 'play' : hasApkDelivery ? 'apk' : ''),
    installedVersionCode: installedForCompare,
    serverVersionCodeTarget: serverTarget,
  };
}

export function mergeUpdateInfo(nativeInfo, normalized) {
  if (!normalized) return nativeInfo;
  const base = nativeInfo && typeof nativeInfo === 'object' ? { ...nativeInfo } : {};
  const merged = { ...base, ...normalized };
  if (!merged.title && normalized.title) merged.title = normalized.title;
  if (!merged.notice && normalized.notice) merged.notice = normalized.notice;
  if (
    (base.decision === 'NONE' || !base.decision) &&
    normalized.decision &&
    normalized.decision !== 'NONE'
  ) {
    merged.decision = normalized.decision;
    merged.decisionRecovered = true;
  }
  return merged;
}
