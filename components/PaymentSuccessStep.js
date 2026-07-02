import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  formatBackendDateTime,
  formatBackendDurationDays,
  formatBackendRemainingDays,
  formatPaymentAmount,
} from '../lib/paymentSuccessDisplay';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const TEXT_MUTED = '#9CA3AF';

function DetailRow({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value || '—'}
      </Text>
    </View>
  );
}

/**
 * Premium payment success dialog (step 4) — backend values only.
 */
export default function PaymentSuccessStep({ details, onOpenChannel }) {
  const planName = details?.planName ?? '—';
  const pricePaid = formatPaymentAmount(details?.amount, details?.currency ?? 'TZS');
  const duration = formatBackendDurationDays(details?.planDurationDays);
  const activatedAt = formatBackendDateTime(details?.startedAt);
  const expiresAt = formatBackendDateTime(details?.expiresAt);
  const remainingDays = formatBackendRemainingDays(details?.remainingDays);

  return (
    <View style={styles.wrap}>
      <Text style={styles.celebration}>🎉 Hongera!</Text>
      <Text style={styles.subtitle}>Umefanikiwa kununua kifurushi.</Text>

      <View style={styles.iconHalo}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={28} color="#0F172A" />
        </View>
      </View>

      <View style={styles.detailsCard}>
        <DetailRow label="Kifurushi" value={planName} />
        <DetailRow label="Bei" value={pricePaid} />
        <DetailRow label="Muda" value={duration} />
        <DetailRow label="Imeanzishwa" value={activatedAt} />
        <DetailRow label="Inaisha" value={expiresAt} />
        <DetailRow label="Siku zilizobaki" value={remainingDays} />
      </View>

      <Text style={styles.message}>
        Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.
      </Text>

      <Pressable style={styles.ctaWrap} onPress={onOpenChannel} accessibilityRole="button">
        <LinearGradient
          colors={ACCENT_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ctaGradient}
        >
          <Text style={styles.ctaText}>FUNGUA CHANNEL</Text>
        </LinearGradient>
      </Pressable>
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
    marginBottom: 4,
  },
  subtitle: {
    color: '#F3F4F6',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
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
  detailsCard: {
    width: '100%',
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
    minWidth: 92,
  },
  detailValue: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  message: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
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
    letterSpacing: 0.6,
  },
});
