import React, { useEffect, useRef } from 'react';
import {
  beginEmbeddedLaunchGate,
} from '../lib/embeddedLaunchGate';
import {
  collectOtaBootGateSnapshot,
  shouldRunOtaBootGate,
} from '../lib/otaBootGatePolicy';

/**
 * Runs embedded OTA sync in the background — never blocks Home or shows a loading screen.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function EmbeddedOtaBootGate({ children }) {
  const gateStartedRef = useRef(false);
  const shouldBlock = shouldRunOtaBootGate();

  useEffect(() => {
    const snap = collectOtaBootGateSnapshot();
    console.log('[embedded-launch-gate]', 'gate_mounted', snap);
    if (!shouldBlock) {
      console.log('[embedded-launch-gate]', 'gate_released', {
        reason: 'no_block_on_mount',
        ...snap,
      });
    }
  }, [shouldBlock]);

  useEffect(() => {
    if (!shouldBlock || gateStartedRef.current) return undefined;
    gateStartedRef.current = true;

    console.log('[embedded-launch-gate]', 'gate_background', collectOtaBootGateSnapshot());

    void beginEmbeddedLaunchGate()
      .catch((e) => {
        console.log('[embedded-launch-gate]', 'boot_gate_error', e?.message ?? e);
      })
      .finally(() => {
        console.log('[embedded-launch-gate]', 'gate_released', {
          reason: 'gate_promise_settled',
          ...collectOtaBootGateSnapshot(),
        });
      });

    return undefined;
  }, [shouldBlock]);

  return children;
}
