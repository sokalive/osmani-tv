import React, { useEffect } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const SHEET_BG = '#0F1115';
const TEXT_MUTED = '#9CA3AF';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_SHEET_H = Math.min(320, Math.round(WINDOW_HEIGHT * 0.62));

/**
 * Blocking admin manual gift acknowledgment — only `onAcknowledge` may dismiss.
 * @param {{ visible: boolean; busy?: boolean; onAcknowledge: () => void | Promise<void> }} props
 */
export default function ManualSubscriptionGiftModal({ visible, busy = false, onAcknowledge }) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
      presentationStyle="overFullScreen"
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.touchBlocker} />
        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { maxHeight: MAX_SHEET_H }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.scrollInner}
            >
              <View style={styles.handleBar} />
              <Text style={styles.title}>Hongera!</Text>
              <Text style={styles.body}>
                {
                  'Umepokea kifurushi cha Ofa kutoka kwa Muhudumu Wetu. Sasa Unaweza Kutazama Channel Zote Bureee Kuanzia sasa🥳.'
                }
              </Text>
              <Pressable
                style={[styles.ctaWrap, busy && styles.ctaDisabled]}
                onPress={onAcknowledge}
                disabled={busy}
              >
                <LinearGradient
                  colors={ACCENT_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.ctaGradient}
                >
                  {busy ? (
                    <ActivityIndicator color="#111827" />
                  ) : (
                    <Text style={styles.ctaText}>ASANTE</Text>
                  )}
                </LinearGradient>
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
  /** Blocks interaction with content behind the modal (does not dismiss). */
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  centeredWrap: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  sheet: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: SHEET_BG,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.18)',
    elevation: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
  },
  scrollInner: {
    paddingBottom: Platform.OS === 'ios' ? 2 : 6,
  },
  handleBar: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(250,204,21,0.30)',
    marginBottom: 10,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.4,
  },
  body: {
    color: TEXT_MUTED,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  ctaWrap: {
    width: '100%',
    minHeight: 52,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 14,
    shadowColor: '#FACC15',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
  },
  ctaDisabled: {
    opacity: 0.85,
  },
  ctaGradient: {
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  ctaText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
