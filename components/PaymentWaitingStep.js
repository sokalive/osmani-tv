import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CHECKOUT_GATEWAY_META } from '../lib/checkoutPaymentProviders';

const ACCENT = '#FACC15';
const ACCENT_GLOW = 'rgba(250, 204, 21, 0.55)';
const TEXT_MUTED = '#9CA3AF';
const WARNING = '#F59E0B';
const SUCCESS = '#4ADE80';

const PROGRESS_STEPS = [
  { key: 0, label: 'Ombi la Malipo Limetumwa' },
  { key: 1, label: 'Inasubiri Uthibitisho wa PIN' },
  { key: 2, label: 'Uthibitisho wa Malipo' },
  { key: 3, label: 'Uanzishaji wa Kifurushi' },
];

const TIPS = [
  'Hakikisha simu yako imewashwa.',
  'Hakikisha una salio la kutosha.',
  'Angalia ujumbe wa malipo uliotumwa.',
  'Weka namba yako ya siri (PIN).',
  'Usifunge programu wakati malipo yanaendelea.',
];

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function providerLabel(provider) {
  const id = String(provider ?? 'zenopay').toLowerCase();
  return CHECKOUT_GATEWAY_META[id]?.name ?? 'Malipo';
}

function statusLabel(step) {
  if (step >= 3) return 'Inaanzisha Kifurushi';
  if (step >= 2) return 'Inathibitisha Malipo';
  return 'Inasubiri PIN';
}

/**
 * Premium payment waiting UI (step 3 only — no checkout logic).
 *
 * @param {{
 *   selectedAmountDisplay: string;
 *   orderId: string|null;
 *   remainingSeconds: number;
 *   checkoutProvider: string;
 *   checkoutLogoUrl?: string|null;
 *   paymentProgressStep: number;
 *   ringSpin: Animated.AnimatedInterpolation<string|number>;
 * }} props
 */
export default function PaymentWaitingStep({
  selectedAmountDisplay,
  orderId,
  remainingSeconds,
  checkoutProvider,
  checkoutLogoUrl,
  paymentProgressStep,
  ringSpin,
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  const providerMeta = CHECKOUT_GATEWAY_META[checkoutProvider] ?? CHECKOUT_GATEWAY_META.zenopay;
  const currentStep = Math.min(Math.max(paymentProgressStep, 0), 3);

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.loaderHaloWrap, { transform: [{ scale: pulseScale }] }]}>
        <Animated.View style={[styles.loaderRing, { transform: [{ rotate: ringSpin }] }]} />
        <View style={styles.loaderInner}>
          <Ionicons name="phone-portrait-outline" size={32} color={ACCENT} />
        </View>
      </Animated.View>

      <View style={styles.amountBadge}>
        <Ionicons name="wallet" size={16} color={ACCENT} />
        <Text style={styles.amountBadgeText}>{selectedAmountDisplay}</Text>
      </View>

      <Text style={styles.title}>Inasubiri Uthibitisho wa Malipo</Text>

      <View style={styles.badgeRow}>
        <View style={styles.providerBadge}>
          {checkoutLogoUrl ? (
            <Image source={{ uri: checkoutLogoUrl }} style={styles.providerLogo} resizeMode="contain" />
          ) : (
            <View style={[styles.providerIcon, { backgroundColor: providerMeta.accent }]}>
              <Text style={styles.providerIconText}>{providerMeta.initial}</Text>
            </View>
          )}
          <Text style={styles.providerBadgeText}>{providerLabel(checkoutProvider)}</Text>
        </View>
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusBadgeText}>{statusLabel(currentStep)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.bodyLead}>
          Tumetuma ombi la malipo kwenye simu yako.
        </Text>
        <Text style={styles.bodyText}>
          Tafadhali fungua ujumbe wa malipo uliotumwa na mtoa huduma wako.
        </Text>
        <Text style={styles.bodyText}>
          Thibitisha kwa kuingiza PIN yako ili kukamilisha malipo ya kifurushi hiki.
        </Text>
        <Text style={styles.bodyEmphasis}>
          Baada ya kuthibitisha, kifurushi kitaanza kutumika moja kwa moja.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.cardHeading}>Hatua za Malipo</Text>
        {PROGRESS_STEPS.map((item, index) => {
          const done = currentStep > item.key;
          const active = currentStep === item.key;
          return (
            <View key={item.key}>
              <View style={styles.progressRow}>
                <View
                  style={[
                    styles.progressDot,
                    done && styles.progressDotDone,
                    active && styles.progressDotActive,
                  ]}
                >
                  {done ? (
                    <Ionicons name="checkmark" size={12} color="#0F172A" />
                  ) : (
                    <Text style={[styles.progressDotNum, active && styles.progressDotNumActive]}>
                      {item.key + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.progressLabel,
                    done && styles.progressLabelDone,
                    active && styles.progressLabelActive,
                  ]}
                >
                  {item.label}
                </Text>
              </View>
              {index < PROGRESS_STEPS.length - 1 ? (
                <View style={[styles.progressLine, done && styles.progressLineDone]} />
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.estimateCard}>
        <Ionicons name="time-outline" size={18} color={ACCENT} />
        <View style={styles.estimateTextCol}>
          <Text style={styles.estimateTitle}>Muda unaokadiriwa</Text>
          <Text style={styles.countdown}>
            {remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '--:--'}
          </Text>
          <Text style={styles.estimateHint}>Thibitisha malipo kwenye simu yako haraka iwezekanavyo.</Text>
        </View>
      </View>

      {orderId ? (
        <View style={styles.orderCard}>
          <View style={styles.orderCardHeader}>
            <Ionicons name="receipt-outline" size={16} color={ACCENT} />
            <Text style={styles.orderCardTitle}>Order ID</Text>
          </View>
          <Text style={styles.orderCardValue} selectable numberOfLines={2}>
            {orderId}
          </Text>
        </View>
      ) : null}

      <View style={styles.tipsCard}>
        <Text style={styles.tipsHeading}>Muhimu</Text>
        {TIPS.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <Ionicons name="checkmark-circle" size={16} color={SUCCESS} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>

      <View style={styles.warningCard}>
        <View style={styles.warningHeader}>
          <Ionicons name="warning" size={18} color={WARNING} />
          <Text style={styles.warningTitle}>Tafadhali Usibonyeze &quot;GHAIRI&quot;</Text>
        </View>
        <Text style={styles.warningText}>
          Usibonyeze kitufe cha GHAIRI ikiwa tayari umepokea ombi la malipo kwenye simu yako.
        </Text>
        <Text style={styles.warningText}>
          Subiri kwanza ukamilishe uthibitisho kwa kuweka PIN yako.
        </Text>
        <Text style={styles.warningText}>
          Baada ya kuthibitisha malipo, kifurushi kitaanza kutumika moja kwa moja.
        </Text>
        <Text style={styles.warningFoot}>
          Ikiwa hukupokea ombi la malipo baada ya muda unaofaa, ndipo unaweza kughairi na kujaribu tena.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingVertical: 4,
    paddingBottom: 8,
    gap: 14,
  },
  loaderHaloWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 4,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 20,
    elevation: 12,
  },
  loaderRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: 'rgba(250,204,21,0.16)',
    borderTopColor: ACCENT,
    borderRightColor: ACCENT,
  },
  loaderInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#161B23',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.22)',
  },
  amountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    backgroundColor: 'rgba(250,204,21,0.12)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.35)',
  },
  amountBadgeText: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#1A1F28',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  providerLogo: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  providerIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerIconText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  providerBadgeText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.25)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  statusBadgeText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1A1F28',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  bodyLead: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  bodyText: {
    color: '#D1D5DB',
    fontSize: 13,
    lineHeight: 20,
  },
  bodyEmphasis: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 2,
  },
  progressCard: {
    backgroundColor: '#161A22',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeading: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E222B',
  },
  progressDotDone: {
    backgroundColor: SUCCESS,
    borderColor: SUCCESS,
  },
  progressDotActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(250,204,21,0.15)',
    shadowColor: ACCENT_GLOW,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4,
  },
  progressDotNum: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '800',
  },
  progressDotNumActive: {
    color: ACCENT,
  },
  progressLabel: {
    flex: 1,
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  progressLabelDone: {
    color: '#D1D5DB',
  },
  progressLabelActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  progressLine: {
    width: 2,
    height: 14,
    marginLeft: 11,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
  },
  progressLineDone: {
    backgroundColor: 'rgba(74,222,128,0.45)',
  },
  estimateCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#1A1F28',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.15)',
  },
  estimateTextCol: {
    flex: 1,
    gap: 2,
  },
  estimateTitle: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  countdown: {
    color: ACCENT,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    textShadowColor: ACCENT_GLOW,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  estimateHint: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  orderCard: {
    backgroundColor: '#161A22',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  orderCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  orderCardTitle: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  orderCardValue: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    lineHeight: 18,
  },
  tipsCard: {
    backgroundColor: '#1A1F28',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.18)',
    gap: 10,
  },
  tipsHeading: {
    color: SUCCESS,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tipText: {
    flex: 1,
    color: '#E5E7EB',
    fontSize: 13,
    lineHeight: 19,
  },
  warningCard: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    gap: 8,
    marginBottom: 4,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  warningTitle: {
    color: WARNING,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  warningText: {
    color: '#FDE68A',
    fontSize: 13,
    lineHeight: 20,
  },
  warningFoot: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
