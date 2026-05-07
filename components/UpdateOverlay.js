import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  cancelDownload,
  dismissSoft,
  isNativeAvailable,
  openPlayStoreFromInfo,
  quitForForceCancel,
  startDownload,
  subscribe,
} from '../lib/updateClient';

const COLORS = {
  bg: '#0F1115',
  card: '#1A1D23',
  gold: '#FFCB3D',
  goldDeep: '#E5A722',
  white: '#FFFFFF',
  muted: '#A1A8B5',
  danger: '#FF6B6B',
  border: 'rgba(255,255,255,0.08)',
};

function formatMB(bytes) {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdateOverlay() {
  const [ui, setUi] = useState(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isNativeAvailable()) return undefined;
    const unsub = subscribe(setUi);
    return () => {
      try { unsub(); } catch {}
    };
  }, []);

  if (Platform.OS !== 'android' || !isNativeAvailable()) return null;
  if (!ui || !ui.visible) return null;

  const isForce = ui.decision === 'FORCE';
  const isPlayStore = ui.decision === 'PLAY_STORE';
  const info = ui.info ?? {};
  const installedName = info.installedVersionName || '';
  const latestName = info.latestVersionName || '';
  const sizeText = formatMB(info.apkSizeBytes);

  const inProgress =
    ui.downloading || ui.verifying || ui.installing;

  const percent =
    ui.progress && typeof ui.progress.percent === 'number'
      ? ui.progress.percent
      : -1;

  const headline = isForce
    ? 'Sasisho la lazima'
    : isPlayStore
      ? 'Sasisho linapatikana'
      : 'Sasisho linapatikana';

  const subtitle = isForce
    ? 'Toleo jipya ni la lazima ili kuendelea kutumia Osmani TV.'
    : 'Toleo jipya la Osmani TV liko tayari kupakuliwa.';

  const onPrimary = () => {
    if (isPlayStore) {
      void openPlayStoreFromInfo();
      return;
    }
    void startDownload();
  };

  const onCancel = () => {
    if (isForce) {
      quitForForceCancel();
      return;
    }
    cancelDownload();
    dismissSoft();
  };

  const primaryLabel = (() => {
    if (ui.installing) return 'Inafungua msakinishaji…';
    if (ui.verifying) return 'Inathibitisha…';
    if (ui.downloading) {
      return percent >= 0
        ? `Inapakua… ${percent}%`
        : 'Inapakua…';
    }
    if (ui.needsUnknownSourcesPermission) return 'Ruhusu kisha ujaribu tena';
    if (isPlayStore) return 'Fungua Play Store';
    return 'Pakua na Sakinisha';
  })();

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!isForce) {
          dismissSoft();
        }
      }}
    >
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <LinearGradient
              colors={[COLORS.gold, COLORS.goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconBg}
            >
              <Ionicons
                name={isForce ? 'shield-checkmark' : 'cloud-download'}
                size={28}
                color="#000"
              />
            </LinearGradient>
          </View>

          <Text style={styles.title}>{headline}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.versionRow}>
            {installedName ? (
              <Text style={styles.versionMuted}>{installedName}</Text>
            ) : null}
            <Ionicons
              name="arrow-forward"
              size={14}
              color={COLORS.muted}
              style={{ marginHorizontal: 6 }}
            />
            <Text style={styles.versionGold}>{latestName || '—'}</Text>
            {sizeText ? (
              <Text style={styles.versionMuted}> · {sizeText}</Text>
            ) : null}
          </View>

          {info.releaseNotes ? (
            <Text style={styles.notes} numberOfLines={6}>
              {info.releaseNotes}
            </Text>
          ) : null}

          {ui.downloading ? (
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width:
                      percent >= 0 ? `${Math.max(2, percent)}%` : '20%',
                  },
                ]}
              />
            </View>
          ) : null}

          {ui.failedReason ? (
            <Text style={styles.error}>
              Imeshindikana: {String(ui.failedReason)}
            </Text>
          ) : null}

          {ui.needsUnknownSourcesPermission ? (
            <Text style={styles.warn}>
              Ruhusu Osmani TV kusakinisha kutoka chanzo hiki, kisha
              gusa "{primaryLabel}" tena.
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onPrimary}
              disabled={inProgress}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.85 },
                inProgress && { opacity: 0.7 },
              ]}
            >
              {ui.downloading || ui.verifying || ui.installing ? (
                <ActivityIndicator color="#000" />
              ) : null}
              <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
            </Pressable>

            {isForce ? (
              <Pressable onPress={onCancel} style={styles.linkBtn}>
                <Text style={styles.linkBtnTextDanger}>Funga programu</Text>
              </Pressable>
            ) : (
              <Pressable onPress={onCancel} style={styles.linkBtn}>
                <Text style={styles.linkBtnText}>
                  {ui.downloading ? 'Sitisha' : 'Baadaye'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.card,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  iconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.gold,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  versionRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  versionMuted: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  versionGold: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  notes: {
    marginTop: 14,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'left',
  },
  progressBarTrack: {
    marginTop: 16,
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.gold,
    borderRadius: 4,
  },
  error: {
    marginTop: 12,
    color: COLORS.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  warn: {
    marginTop: 12,
    color: COLORS.gold,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  actions: {
    marginTop: 18,
  },
  primaryBtn: {
    backgroundColor: COLORS.gold,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    shadowColor: COLORS.gold,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  linkBtn: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkBtnText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  linkBtnTextDanger: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
