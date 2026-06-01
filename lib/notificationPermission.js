/**
 * Web: no native push permission UI.
 * @returns {Promise<boolean>}
 */
export async function getOsmaniNotificationPermissionGranted() {
  return true;
}

/**
 * @returns {Promise<boolean>}
 */
export async function requestOsmaniNotificationPermission() {
  return false;
}
