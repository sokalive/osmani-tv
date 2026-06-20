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

/**
 * Blocks Home, catalog, navigation, and playback until stale JS is replaced via OTA.
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

    console.log('[embedded-launch-gate]', 'gate_blocking_ui', collectOtaBootGateSnapshot());
    void SplashScreen.preventAutoHideAsync().catch(() => {});

    void beginEmbeddedLaunchGate()
      .catch((e) => {
        console.log('[embedded-launch-gate]', 'boot_gate_error', e?.message ?? e);
      })
      .finally(() => {
        void SplashScreen.hideAsync().catch(() => {});
        console.log('[embedded-launch-gate]', 'gate_released', {
          reason: 'gate_promise_settled',
          ...collectOtaBootGateSnapshot(),
        });
        setBootReady(true);
      });

    return undefined;
  }, [bootReady]);

  if (!bootReady) {
    return <EmbeddedOtaLoadingScreen phase={phase} downloadProgress={downloadProgress} />;
  }

  return children;
}

export { awaitEmbeddedLaunchGate, shouldRunOtaBootGate };
