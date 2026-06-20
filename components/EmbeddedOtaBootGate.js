import React, { useEffect, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import EmbeddedOtaLoadingScreen from './EmbeddedOtaLoadingScreen';
import {
  awaitEmbeddedLaunchGate,
  beginEmbeddedLaunchGate,
} from '../lib/embeddedLaunchGate';
import { subscribeEmbeddedOtaProgress } from '../lib/embeddedLaunchOtaProgress';
import {
  collectOtaBootGateSnapshot,
  shouldRunOtaBootGate,
} from '../lib/otaBootGatePolicy';
import { logStartupPaint } from '../lib/startupPaintDiagnostics';

/** Never leave users on a blank/black frame waiting for OTA gate. */
const OTA_GATE_MAX_BLOCK_MS = 12_000;

/**
 * Blocks Home only on embedded/stale first launch until OTA sync completes or times out.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function EmbeddedOtaBootGate({ children }) {
  const updates = Updates.useUpdates();
  const gateStartedRef = useRef(false);
  const shouldBlock = shouldRunOtaBootGate();
  const [bootReady, setBootReady] = useState(!shouldBlock);
  const [phase, setPhase] = useState('checking');
  const [downloadProgress, setDownloadProgress] = useState(null);

  useEffect(() => {
    logStartupPaint('embedded_gate_mounted', { shouldBlock });
    const snap = collectOtaBootGateSnapshot();
    console.log('[embedded-launch-gate]', 'gate_mounted', snap);
    if (!shouldBlock) {
      logStartupPaint('embedded_gate_skip');
      console.log('[embedded-launch-gate]', 'gate_released', {
        reason: 'no_block_on_mount',
        ...snap,
      });
    }
  }, [shouldBlock]);

  useEffect(() => {
    const unsub = subscribeEmbeddedOtaProgress((snap) => {
      setPhase(snap.phase);
      setDownloadProgress(snap.downloadProgress);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (Number.isFinite(updates.downloadProgress)) {
      setDownloadProgress(updates.downloadProgress);
    }
    if (updates.isChecking) setPhase('checking');
    if (updates.isDownloading) setPhase('downloading');
    if (updates.isRestarting) setPhase('reloading');
  }, [
    updates.downloadProgress,
    updates.isChecking,
    updates.isDownloading,
    updates.isRestarting,
  ]);

  useEffect(() => {
    if (bootReady || gateStartedRef.current) return undefined;
    gateStartedRef.current = true;

    logStartupPaint('embedded_gate_blocking');
    console.log('[embedded-launch-gate]', 'gate_blocking_ui', collectOtaBootGateSnapshot());
    void SplashScreen.preventAutoHideAsync().catch(() => {});

    const release = (reason) => {
      logStartupPaint('embedded_gate_released', { reason });
      console.log('[embedded-launch-gate]', 'gate_released', {
        reason,
        ...collectOtaBootGateSnapshot(),
      });
      setBootReady(true);
    };

    const maxTimer = setTimeout(() => {
      release('max_block_timeout');
    }, OTA_GATE_MAX_BLOCK_MS);

    void beginEmbeddedLaunchGate()
      .catch((e) => {
        console.log('[embedded-launch-gate]', 'boot_gate_error', e?.message ?? e);
      })
      .finally(() => {
        clearTimeout(maxTimer);
        release('gate_promise_settled');
      });

    return () => clearTimeout(maxTimer);
  }, [bootReady]);

  if (!bootReady) {
    return <EmbeddedOtaLoadingScreen phase={phase} downloadProgress={downloadProgress} />;
  }

  return children;
}

export { awaitEmbeddedLaunchGate, shouldRunOtaBootGate };
