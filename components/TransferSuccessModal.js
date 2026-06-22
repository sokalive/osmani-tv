import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Source-device success popup after subscription transfer completes.
 * Non-blocking — user may dismiss with Cancel; premium access stays revoked.
 */
export default function TransferSuccessModal({ visible, onBuyAgain, onDismiss }) {
  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="checkmark-circle" size={40} color="#4ADE80" />
          </View>
          <Text style={styles.title}>Hongera, Kifurushi Kimehamishwa</Text>
          <Text style={styles.body}>
            Kifurushi chako kimehamishwa kwenda kifaa kingine. Simu hii haina tena kifurushi cha
            premium. Unaweza kununua kifurushi kipya ili kuendelea kutazama channel za kulipia.
          </Text>
          <Pressable
            onPress={onBuyAgain}
            style={styles.primaryWrap}
            accessibilityRole="button"
            accessibilityLabel="Nunua Kifurushi Tena"
          >
            <LinearGradient
              colors={['#FFCB3D', '#E5A020']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryGradient}
            >
              <Text style={styles.primaryText}>NUNUA KIFURUSHI TENA</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.secondaryText}>CANCEL</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F1115',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.28)',
    ...Platform.select({
      android: { elevation: 18 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.38,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
      },
      default: {},
    }),
  },
  iconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(74,222,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
  },
  body: {
    marginTop: 12,
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryWrap: {
    marginTop: 22,
    borderRadius: 16,
    overflow: 'hidden',
  },
  primaryGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  secondaryText: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.35,
  },
});
