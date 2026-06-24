import React from 'react';
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

/**
 * Hard-blocking modal shown whenever the backend reports the
 * subscription is no longer active on this device — either after a
 * transfer to another phone or because the plan expired/was revoked.
 *
 * The user CANNOT dismiss it by tapping outside; the only forward
 * actions are "Lipia tena" (open plans) or "Rejesha kifurushi" (recover).
 */
export default function TransferredAwayModal({
  visible,
  reason = 'transferred',
  onOpenPlans,
  onRecover,
  recovering = false,
}) {
  const title =
    reason === 'transferred'
      ? 'Kifurushi kimehamishwa'
      : reason === 'revoked'
        ? 'Kifurushi kimezuiwa'
        : reason === 'suspended'
          ? 'Kifurushi kimesimamishwa'
          : 'Kifurushi kimekwisha';

  const body =
    reason === 'transferred'
      ? 'Kifurushi chako kimehamishwa kwenda kifaa kingine. Hauwezi tena kutazama channel za kulipia kwenye simu hii hadi ulipie tena au urudishe kifurushi.'
      : reason === 'revoked'
        ? 'Admin amezuia kifurushi chako. Tafadhali wasiliana na admin au lipia tena ili kuendelea.'
        : reason === 'suspended'
          ? 'Admin amesimamisha ufikiaji wa kifurushi chako kwa muda. Tafadhali wasiliana na admin au lipia tena ili kuendelea.'
          : 'Kifurushi chako kimekwisha. Lipia tena au rudisha kifurushi ili kuendelea kutazama.';

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={36} color="#FBBF24" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <Pressable
            onPress={onOpenPlans}
            style={styles.primaryWrap}
            accessibilityRole="button"
            accessibilityLabel="Lipia tena"
          >
            <LinearGradient
              colors={['#FFCB3D', '#E5A020']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryGradient}
            >
              <Text style={styles.primaryText}>LIPIA TENA</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            onPress={onRecover}
            disabled={recovering}
            style={[styles.secondaryBtn, recovering && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Rejesha kifurushi"
          >
            {recovering ? (
              <ActivityIndicator color="#FBBF24" />
            ) : (
              <Text style={styles.secondaryText}>Rejesha kifurushi</Text>
            )}
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
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.45)',
  },
  secondaryText: {
    color: '#FBBF24',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.5,
  },
});
