import React, { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import EmbeddedOtaLoadingScreen from './EmbeddedOtaLoadingScreen';
import {
  isEmbeddedLaunchRuntime,
  runEmbeddedLaunchOtaGate,
} from '../lib/embeddedLaunchGate';
import { subscribeEmbeddedOtaProgress } from '../lib/embeddedLaunchOtaProgress';

/**
 * Blocks Home, catalog, navigation, and playback on embedded first launch
 * until OTA is downloaded and applied (automatic reload).
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function EmbeddedOtaBootGate({ children }) {
  const updates = Updates.useUpdates();
  const [bootReady, setBootReady] = useState(() => !isEmbeddedLaunchRuntime());
  const [phase, setPhase] = useState('checking');
  const [downloadProgress, setDownloadProgress] = useState(null);

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
    if (bootReady) return undefined;

    let cancelled = false;

    void SplashScreen.preventAutoHideAsync().catch(() => {});

    void runEmbeddedLaunchOtaGate()
      .catch((e) => {
        console.log('[embedded-launch-gate]', 'boot_gate_error', e?.message ?? e);
      })
      .finally(() => {
        if (!cancelled) {
          void SplashScreen.hideAsync().catch(() => {});
          setBootReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootReady]);

  if (!bootReady) {
    return <EmbeddedOtaLoadingScreen phase={phase} downloadProgress={downloadProgress} />;
  }

  return children;
}

export { isEmbeddedLaunchRuntime };
