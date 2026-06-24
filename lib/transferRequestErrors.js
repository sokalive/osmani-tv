import { isNetworkTransportError } from './catalogApiFetch';
import { formatUserFacingApiError, isTransientServerError } from './catalogConnectivity';

const NO_SUBSCRIPTION_EN =
  'no active subscription found for this payment phone';
const NO_SUBSCRIPTION_SW =
  'Hakuna kifurushi hai kilichohusishwa na namba hii ya malipo. Hakikisha umeingiza namba iliyotumika kulipia.';

/**
 * @param {unknown} errorLike
 * @param {number} [httpStatus]
 * @returns {string}
 */
export function formatTransferRequestUserMessage(errorLike, httpStatus = 0) {
  const status = Number(httpStatus) || Number(errorLike?.httpStatus) || 0;
  const raw = String(errorLike?.message ?? errorLike ?? '').trim();
  const lower = raw.toLowerCase();

  if (
    isTransientServerError(raw) ||
    isTransientServerError(`HTTP ${status}`) ||
    isNetworkTransportError(raw) ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return formatUserFacingApiError(raw || `HTTP ${status}`);
  }

  if (lower.includes(NO_SUBSCRIPTION_EN)) {
    return NO_SUBSCRIPTION_SW;
  }

  if (status >= 500) {
    return formatUserFacingApiError(raw || `HTTP ${status}`);
  }

  if (!raw) return 'Imeshindwa kuomba code. Jaribu tena.';
  return raw;
}

/**
 * @param {number} status
 * @param {string} reason
 * @param {unknown} [body]
 */
export function createTransferRequestError(status, reason, body) {
  const err = new Error(String(reason ?? `HTTP ${status}`));
  err.name = 'TransferRequestError';
  err.httpStatus = status;
  err.body = body;
  return err;
}
