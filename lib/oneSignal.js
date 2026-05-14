/**
 * Web: native OneSignal is not used.
 * @param {{ onOpenUrl?: (url: string) => void }} [_options]
 * @returns {() => void}
 */
export function setupOneSignal(_options) {
  return () => {};
}
