/**
 * Permanently removed expired-package hard-block popup.
 * Stub kept so accidental imports stay inert. If anything ever mounts this
 * again, the trace below identifies the caller — the component still renders
 * nothing under any circumstance.
 */
export default function TransferredAwayModal(props) {
  try {
    console.log('[KIFURUSHI_POPUP_REQUEST_BLOCKED]', {
      component: 'TransferredAwayModal',
      props: (() => {
        try {
          return JSON.stringify(props)?.slice(0, 500) ?? null;
        } catch {
          return '[unserializable]';
        }
      })(),
      currentRoute: globalThis.__OSMANI_CURRENT_ROUTE__ ?? null,
      callerStack: new Error('KIFURUSHI_POPUP_REQUEST_TRACE').stack ?? null,
    });
  } catch {
    // diagnostics must never throw
  }
  return null;
}
