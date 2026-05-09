import React from 'react';
import {
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
import { LinearGradient } from 'expo-linear-gradient';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const SHEET_BG = '#0F1115';
const TEXT_MUTED = '#9CA3AF';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_H = Math.min(380, Math.round(WINDOW_HEIGHT * 0.72));

/**
 * Home-only subscription expiry nudge (controlled by parent visibility + timer).
 * @param {{ visible: boolean; displayDays: number; onRenew: () => void; onDismissLater: () => void }} props
 */
export default function SubscriptionExpiryReminderModal({
  visible,
  displayDays,
  onRenew,
  onDismissLater,
}) {
  const insets = useSafeAreaInsets();
  const days = Math.min(2, Math.max(1, Number(displayDays) || 1));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismissLater}>
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismissLater} />
        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { maxHeight: MAX_SHEET }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.scrollInner}
            >
              <View style={styles.handleBar} />
              <Text style={styles.body}>
                Kifurushi chako kimebakiza siku {days} kuisha. Tafadhali lipia kifurushi chako kabla ya muda
                kuisha.
              </Text>
              <Pressable style={styles.ctaWrap} onPress={onRenew}>
                <LinearGradient
                  colors={ACCENT_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.ctaGradient}
                >
                  <Text style={styles.ctaText}>LIPIA TENA</Text>
                </LinearGradient>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={onDismissLater}>
                <Text style={styles.secondaryBtnText}>SIKU NYINGINE</Text>
              </Pressable>
            </ScrollView>
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
    backgroundColor: 'rgba(0,0,0,0.7)',
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
    paddingBottom: Platform.OS === 'ios' ? 4 : 8,
  },
  handleBar: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(250,204,21,0.30)',
    marginBottom: 14,
  },
  body: {
    color: TEXT_MUTED,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  ctaWrap: {
    width: '100%',
    minHeight: 58,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 14,
    shadowColor: '#FACC15',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
  },
  ctaGradient: {
    minHeight: 58,
    paddingVertical: 17,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  ctaText: {
    color: '#111827',
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
