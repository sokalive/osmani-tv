import React, { useEffect } from 'react';
import {
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
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const SHEET_BG = '#0F1115';
const TEXT_MUTED = '#9CA3AF';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_H = Math.min(420, Math.round(WINDOW_HEIGHT * 0.78));

/**
 * Near-expiry reminder — same visual language as PremiumModal / ManualSubscriptionGiftModal.
 * @param {{
 *   visible: boolean;
 *   displaySikuX: number;
 *   onRenew: () => void;
 *   onCancel: () => void;
 * }} props
 */
export default function SubscriptionExpiryReminderModal({
  visible,
  displaySikuX,
  onRenew,
  onCancel,
}) {
  const insets = useSafeAreaInsets();
  const x = Math.max(1, Math.min(99, Number(displaySikuX) || 1));

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [visible, onCancel]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel}>
          <BlurView
            intensity={Platform.OS === 'ios' ? 38 : 50}
            tint="dark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          />
        </Pressable>
        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { maxHeight: MAX_SHEET_H }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.scrollInner}
            >
              <View style={styles.handleBar} />
              <Text style={styles.title}>KIFURUSHI 💰</Text>
              <Text style={styles.body}>
                Habari! Kifurushi chako kimebakiza siku {x} kuisha. Tafadhali lipia mapema kabla ya kifurushi
                chako kuisha kuepuka kukosa burudani.
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
              <Pressable style={styles.secondaryBtn} onPress={onCancel}>
                <Text style={styles.secondaryBtnText}>CANCEL</Text>
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
  title: {
    color: '#F9FAFB',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.6,
    marginBottom: 12,
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
