/**
 * Mandatory update policy: Force Update or Admin Auto Download.
 * When mandatory, the update overlay must not be dismissible until the app is current.
 */

export function hasAutoDownloadEnabled(info) {
  if (!info || typeof info !== 'object') return false;
  return info.autoDownload === true || info.auto_download === true;
}

/**
 * @param {Record<string, unknown>|null|undefined} info
 * @param {string} [decision]
 */
export function isMandatoryUpdate(info, decision) {
  if (decision === 'FORCE') return true;
  return hasAutoDownloadEnabled(info);
}
