/** Latest combined access verification fields for backend telemetry payloads. */

let lastFields = null;

/**
 * @param {{
 *   deviceAccessState: string;
 *   deviceAccessReason: string;
 *   accessVerificationResult: string;
 *   userMessage: string;
 *   playbackAllowed?: boolean;
 * } | null} next
 */
export function setLastDeviceAccessReportFields(next) {
  lastFields = next;
}

export function getLastDeviceAccessReportFields() {
  return lastFields;
}
