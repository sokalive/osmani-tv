import React, { useEffect } from 'react';
import {
  BackHandler,
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
 * Context-aware premium access prompt — user-intent only (never auto on boot/resume).
 *
 * @param {{
 *   visible: boolean;
 *   variant: 'inactive' | 'expired';
 *   onChoosePackage: () => void;
 *   onClose: () => void;
 * }} props
 */
export default function PremiumAccessPromptModal({
  visible,
  variant = 'inactive',
  onChoosePackage,
  onClose,
}) {
  const isExpired = variant === 'expired';

  const title = isExpired ? 'Kifurushi chako kimeisha' : 'Unahitaji kifurushi';
  const body = isExpired
    ? 'Chagua kifurushi ili kuendelea kutazama.'
    : 'Chagua kifurushi ili kuendelea kutazama channel hii.';

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={36} color="#FBBF24" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <Pressable
            onPress={onChoosePackage}
            style={styles.primaryWrap}
            accessibilityRole="button"
            accessibilityLabel="Chagua kifurushi"
          >
            <LinearGradient
              colors={['#FFCB3D', '#E5A020']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryGradient}
            >
              <Text style={styles.primaryText}>CHAGUA KIFURUSHI</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F1115',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.34)',
    ...Platform.select({
      android: { elevation: 18 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
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
    backgroundColor: 'rgba(251,191,36,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
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
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
