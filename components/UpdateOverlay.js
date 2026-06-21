import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  cancelDownload,
  dismissSoft,
  getUpdateAction,
  isNativeAvailable,
  launchInstaller,
  openPlayStoreFromInfo,
  startDownload,
  subscribe,
} from '../lib/updateClient';

const SHEET_BG = '#0F1115';
const TEXT_MUTED = '#9CA3AF';
const BODY_TEXT = '#FFFFFF';
const CTA_RED = '#DC2626';
const CTA_TEXT = '#FFFFFF';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_H = Math.min(480, Math.round(WINDOW_HEIGHT * 0.82));

function formatMB(bytes) {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultTitle(decision) {
  if (decision === 'FORCE') return 'Update Required';
  if (decision === 'PLAY_STORE') return 'Update Available';
  return 'Update Available';
}

function defaultMessage(decision) {
  if (decision === 'FORCE') {
    return 'A new version is required to continue using Osmani TV. Please download and install the update.';
  }
  return 'A new version of Osmani TV is ready. Download and install to get the latest features and fixes.';
}

/**
 * Derives UI phase for button labels and progress display.
 * @returns {'checking'|'idle'|'downloading'|'verifying'|'downloaded'|'installing'|'failed'|'needs_permission'}
 */
function derivePhase(ui) {
  if (ui.checking) return 'checking';
  if (ui.failedReason) return 'failed';
  if (ui.needsUnknownSourcesPermission) return 'needs_permission';
  if (ui.installing) return 'installing';
  if (ui.downloaded) return 'downloaded';
  if (ui.verifying) return 'verifying';
  if (ui.downloading) return 'downloading';
  return 'idle';
}

export default function UpdateOverlay() {
  const insets = useSafeAreaInsets();
  const [ui, setUi] = useState(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isNativeAvailable()) return undefined;
    const unsub = subscribe(setUi);
    return () => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const phase = useMemo(() => (ui ? derivePhase(ui) : 'idle'), [ui]);

  const isForce = ui?.decision === 'FORCE';
  const isPlayStore = ui?.decision === 'PLAY_STORE';

  useEffect(() => {
    if (!ui?.visible) return undefined;
    const infoSnap = ui?.info ?? {};
    const autoLock =
      infoSnap.autoDownload === true &&
      (phase === 'downloading' || phase === 'verifying');
    const block = ui?.decision === 'FORCE' || autoLock;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (block) return true;
      if (phase === 'downloading' || phase === 'verifying') {
        cancelDownload();
      }
      dismissSoft();
      return true;
    });
    return () => sub.remove();
  }, [ui?.visible, ui?.decision, ui?.info, phase]);

  if (Platform.OS !== 'android' || !isNativeAvailable()) return null;
  if (!ui || !ui.visible) return null;

  const info = ui.info ?? {};
  const action = getUpdateAction(info);

  const autoDownloadLock =
    info.autoDownload === true && (phase === 'downloading' || phase === 'verifying');
  const blockDismiss = isForce || autoDownloadLock;

  const title = String(info.title ?? '').trim() || defaultTitle(ui.decision);
  const message =
    String(info.notice ?? '').trim() ||
    String(info.releaseNotes ?? '').trim() ||
    defaultMessage(ui.decision);

  const installedName = info.installedVersionName || '';
  const latestName = info.latestVersionName || '';
  const sizeText = formatMB(info.apkSizeBytes);

  const percent =
    ui.progress && typeof ui.progress.percent === 'number' ? ui.progress.percent : -1;

  const busy =
    phase === 'checking' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'installing';

  const onPrimary = () => {
    if (phase === 'failed') {
      void startDownload();
      return;
    }
    if (phase === 'downloaded' || phase === 'needs_permission') {
      void launchInstaller();
      return;
    }
    if (isPlayStore || (!action.canDownload && action.canOpenStore)) {
      void openPlayStoreFromInfo();
      return;
    }
    void startDownload();
  };

  const onCancel = () => {
    if (isForce || autoDownloadLock) return;
    if (phase === 'downloading' || phase === 'verifying') {
      cancelDownload();
    }
    dismissSoft();
  };

  const primaryLabel = (() => {
    if (phase === 'checking') return 'CHECKING…';
    if (phase === 'installing') return 'OPENING INSTALLER…';
    if (phase === 'verifying') return 'VERIFYING…';
    if (phase === 'downloading') {
      return percent >= 0 ? `DOWNLOADING… ${percent}%` : 'DOWNLOADING…';
    }
    if (phase === 'downloaded') return 'OPEN INSTALLER';
    if (phase === 'needs_permission') return 'OPEN INSTALLER';
    if (phase === 'failed') return 'RETRY';
    if (isPlayStore || (!action.canDownload && action.canOpenStore)) return 'UPDATE NOW';
    if (!action.canDownload) return 'NO APK AVAILABLE';
    return isForce ? 'DOWNLOAD NOW' : 'UPDATE NOW';
  })();

  const primaryDisabled =
    busy ||
    (phase === 'idle' && !action.canDownload && !action.canOpenStore);

  const showCancel = !isForce && phase !== 'installing' && !autoDownloadLock;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!blockDismiss) onCancel();
      }}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        {!blockDismiss ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel}>
            <BlurView
              intensity={Platform.OS === 'ios' ? 38 : 50}
              tint="dark"
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={StyleSheet.absoluteFill}
            />
          </Pressable>
        ) : (
          <BlurView
            intensity={Platform.OS === 'ios' ? 38 : 50}
            tint="dark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          />
        )}

        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { maxHeight: MAX_SHEET_H }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              style={styles.messageScroll}
              contentContainerStyle={styles.scrollInner}
            >
              <View style={styles.handleBar} />
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.body}>{message}</Text>

              {installedName || latestName ? (
                <View style={styles.versionRow}>
                  {installedName ? <Text style={styles.versionMuted}>{installedName}</Text> : null}
                  {installedName && latestName ? (
                    <Text style={styles.versionArrow}> → </Text>
                  ) : null}
                  {latestName ? <Text style={styles.versionGold}>{latestName}</Text> : null}
                  {sizeText ? <Text style={styles.versionMuted}> · {sizeText}</Text> : null}
                </View>
              ) : null}

              {phase === 'downloading' || phase === 'verifying' ? (
                <View style={styles.progressBlock}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: percent >= 0 ? `${Math.max(4, percent)}%` : '12%' },
                      ]}
                    />
                  </View>
                  {percent >= 0 ? (
                    <Text style={styles.progressPct}>{percent}%</Text>
                  ) : null}
                </View>
              ) : null}

              {phase === 'failed' && ui.failedReason ? (
                <Text style={styles.errorText}>Download failed: {String(ui.failedReason)}</Text>
              ) : null}

              {phase === 'needs_permission' ? (
                <Text style={styles.warnText}>
                  Allow Osmani TV to install from this source, then tap OPEN INSTALLER again.
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.buttonStack}>
              <Pressable
                style={[styles.ctaWrap, primaryDisabled && styles.ctaDisabled]}
                onPress={onPrimary}
                disabled={primaryDisabled}
              >
                <View style={styles.ctaGradient}>
                  {busy ? <ActivityIndicator color={CTA_TEXT} style={styles.ctaSpinner} /> : null}
                  <Text style={styles.ctaText}>{primaryLabel}</Text>
                </View>
              </Pressable>

              {showCancel ? (
                <Pressable style={styles.secondaryBtn} onPress={onCancel}>
                  <Text style={styles.secondaryBtnText}>CANCEL</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  centeredWrap: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  sheet: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: SHEET_BG,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.18)',
    elevation: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
  },
  scrollInner: {
    paddingBottom: 8,
  },
  messageScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  buttonStack: {
    flexShrink: 0,
    paddingTop: 4,
  },
  handleBar: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(250,204,21,0.30)',
    marginBottom: 14,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  body: {
    color: BODY_TEXT,
    opacity: 1,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  versionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  versionMuted: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
  },
  versionArrow: {
    color: TEXT_MUTED,
    fontSize: 13,
  },
  versionGold: {
    color: '#FFCB3D',
    fontSize: 13,
    fontWeight: '800',
  },
  progressBlock: {
    marginBottom: 16,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFCB3D',
    borderRadius: 4,
  },
  progressPct: {
    marginTop: 8,
    color: '#FFCB3D',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 12,
  },
  warnText: {
    color: '#FFCB3D',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 12,
  },
  ctaWrap: {
    width: '100%',
    minHeight: 58,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 14,
    shadowColor: CTA_RED,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
  },
  ctaDisabled: {
    opacity: 0.65,
  },
  ctaGradient: {
    minHeight: 58,
    paddingVertical: 17,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderRadius: 18,
    backgroundColor: CTA_RED,
  },
  ctaSpinner: {
    marginRight: 10,
  },
  ctaText: {
    color: CTA_TEXT,
    opacity: 1,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    width: '100%',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  secondaryBtnText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});
