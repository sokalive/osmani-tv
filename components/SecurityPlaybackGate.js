import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlaybackSecurityGate, useSecurity } from '../context/SecurityContext';

export function SecurityPlaybackBlock({ onBack }) {
  const gate = usePlaybackSecurityGate();
  if (gate.allowed) return null;

  return (
    <View style={styles.blockRoot}>
      <Ionicons name="shield-outline" size={56} color="#facc15" />
      <Text style={styles.blockTitle}>Usalama wa kifaa</Text>
      <Text style={styles.blockBody}>{gate.message}</Text>
      <Text style={styles.blockMeta}>
        Kiwango: {gate.tier} · Alama: {gate.score}
      </Text>
      {onBack ? (
        <Pressable style={styles.blockBtn} onPress={onBack}>
          <Text style={styles.blockBtnText}>Rudi nyuma</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SecurityPlayerBanner() {
  const { showWarning, warningDismissed, dismissWarning, tier, score, limitedPlayback } = useSecurity();
  const gate = usePlaybackSecurityGate();

  if (!showWarning || warningDismissed || !gate.allowed) return null;

  return (
    <View style={styles.banner} pointerEvents="box-none">
      <View style={styles.bannerInner}>
        <Ionicons name="warning-outline" size={18} color="#fbbf24" />
        <Text style={styles.bannerText} numberOfLines={3}>
          {limitedPlayback
            ? `Onyo la usalama (${tier}, ${score}): uchezaji mdogo unatumika.`
            : `Onyo la usalama (${tier}, ${score}): kifaa kinaweza kuwa kimebadilishwa.`}
        </Text>
        <Pressable onPress={dismissWarning} hitSlop={12}>
          <Ionicons name="close" size={20} color="#e5e7eb" />
        </Pressable>
      </View>
    </View>
  );
}

export function SecurityScanSplash() {
  const { loading } = useSecurity();
  if (!loading) return null;
  return (
    <View style={styles.splash} pointerEvents="none">
      <ActivityIndicator color="#facc15" />
    </View>
  );
}

const styles = StyleSheet.create({
  blockRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 50,
  },
  blockTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 10,
  },
  blockBody: {
    color: '#d1d5db',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  blockMeta: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 14,
  },
  blockBtn: {
    marginTop: 24,
    backgroundColor: '#facc15',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  blockBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 15,
  },
  banner: {
    position: 'absolute',
    top: 48,
    left: 12,
    right: 12,
    zIndex: 40,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(17,24,39,0.92)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
  },
  bannerText: {
    flex: 1,
    color: '#f3f4f6',
    fontSize: 12,
    lineHeight: 16,
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 30,
  },
});
