/**
 * Web / non-native: OneSignal native module is not loaded.
 * @returns {() => void} noop cleanup
 */
export function setupOneSignal() {
  return () => {};
}
