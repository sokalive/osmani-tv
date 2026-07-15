import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatExpiryDateDMY } from '../lib/paymentSuccessDisplay';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const TEXT_MUTED = '#9CA3AF';

/**
 * Premium payment success dialog (step 4).
 */
export default function PaymentSuccessStep({
  details,
  onOpenChannel,
  onDismiss,
  subtitle = 'Malipo yako yamefanikiwa na kifurushi chako kimewashwa kikamilifu.',
  message = 'Sasa unaweza kufungua na kutazama channel zote za moja kwa moja (Live TV) pamoja na vipindi vyote vinavyopatikana ndani ya Osmani TV.',
  channelButtonLabel = '✅ Fungua Channel',
  showDismiss = true,
}) {
  const expiresDisplay = formatExpiryDateDMY(details?.expiresAt);

  return (
    <View style={styles.wrap}>
      <Text style={styles.celebration}>🎉 Hongera!</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.iconHalo}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={28} color="#0F172A" />
        </View>
      </View>

      <View style={styles.expiryCard}>
        <Text style={styles.expiryLabel}>Kifurushi chako kitaisha tarehe:</Text>
        <Text style={styles.expiryValue}>{expiresDisplay}</Text>
      </View>

      <Text style={styles.message}>{message}</Text>
      <Text style={styles.thanks}>Asante kwa kuchagua Osmani TV.</Text>

      <Pressable style={styles.ctaWrap} onPress={onOpenChannel} accessibilityRole="button">
        <LinearGradient
          colors={ACCENT_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ctaGradient}
        >
          <Text style={styles.ctaText}>{channelButtonLabel}</Text>
        </LinearGradient>
      </Pressable>

      {showDismiss && onDismiss ? (
        <Pressable style={styles.dismissBtn} onPress={onDismiss} accessibilityRole="button">
          <Text style={styles.dismissText}>Funga</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  celebration: {
    color: '#FACC15',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#F3F4F6',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  iconHalo: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(74,222,128,0.45)',
  },
  expiryCard: {
    width: '100%',
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.28)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    alignItems: 'center',
    gap: 4,
  },
  expiryLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  expiryValue: {
    color: '#FACC15',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  message: {
    color: '#D1D5DB',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  thanks: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  ctaWrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  ctaGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  dismissBtn: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  dismissText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
});
