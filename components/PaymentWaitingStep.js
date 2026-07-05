import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CHECKOUT_GATEWAY_META } from '../lib/checkoutPaymentProviders';

const ACCENT = '#FACC15';
const ACCENT_GLOW = 'rgba(250, 204, 21, 0.55)';
const TEXT_MUTED = '#9CA3AF';
const SUCCESS = '#4ADE80';

const PROGRESS_STEPS = [
  { key: 0, label: 'Ombi Limetumwa' },
  { key: 1, label: 'Inasubiri PIN' },
  { key: 2, label: 'Uthibitisho Malipo' },
  { key: 3, label: 'Uanzishaji Kifurushi' },
];

const TIPS = [
  'Thibitisha malipo kwa PIN yako.',
  'Subiri kifurushi kikamilike.',
  'Usibonyeze GHAIRI kabla malipo hayajakamilika.',
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

function statusLabel(step, appWaitingState) {
  if (appWaitingState === 'PROVIDER_CONFIRMED_ACTIVATING') return 'Inaanzisha Kifurushi';
  if (appWaitingState === 'RETRYING') return 'Inajaribu Tena';
  if (appWaitingState === 'PHONE_CONFLICT') return 'Namba Inatumika';
  if (appWaitingState === 'MOVED_TO_SIBLING_DEVICE') return 'Kifurushi Kimehamishwa';
  if (step >= 3) return 'Inaanzisha Kifurushi';
  if (step >= 2) return 'Inathibitisha Malipo';
  return 'Inasubiri PIN';
}

function waitingTitle(appWaitingState) {
  if (appWaitingState === 'PROVIDER_CONFIRMED_ACTIVATING') {
    return 'Malipo Yamethibitishwa — Inaanzisha';
  }
  if (appWaitingState === 'RETRYING') return 'Inajaribu Kuunganisha';
  if (appWaitingState === 'PHONE_CONFLICT') return 'Namba Tayari Ina Kifurushi';
  if (appWaitingState === 'MOVED_TO_SIBLING_DEVICE') return 'Kifurushi Kiko Kifaa Kingine';
  return 'Inasubiri Uthibitisho wa Malipo';
}

function waitingBody(appWaitingState) {
  if (appWaitingState === 'PROVIDER_CONFIRMED_ACTIVATING') {
    return 'Malipo yamethibitishwa na mtoa huduma. Tunaweka kifurushi chako — subiri kidogo.';
  }
  if (appWaitingState === 'RETRYING') {
    return 'Tunajaribu tena kuunganisha na seva. Usifunge programu.';
  }
  if (appWaitingState === 'PHONE_CONFLICT') {
    return 'Malipo yamefanikiwa, lakini namba hii tayari ina kifurushi hai kwenye kifaa kingine. Wasiliana na msaada au tumia Hamisha Kifurushi.';
  }
  if (appWaitingState === 'MOVED_TO_SIBLING_DEVICE') {
    return 'Malipo yamefanikiwa. Kifurushi kimehamishwa kwenye kifaa kingine kilichounganishwa na akaunti yako.';
  }
  return null;
}

/**
 * Premium payment waiting UI (step 3 only — no checkout logic).
 */
export default function PaymentWaitingStep({
  selectedAmountDisplay,
  orderId,
  remainingSeconds,
  checkoutProvider,
  checkoutLogoUrl,
  paymentProgressStep,
  appWaitingState,
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
    outputRange: [1, 1.05],
  });

  const providerMeta = CHECKOUT_GATEWAY_META[checkoutProvider] ?? CHECKOUT_GATEWAY_META.zenopay;
  const currentStep = Math.min(Math.max(paymentProgressStep, 0), 3);
  const waitingState = String(appWaitingState ?? '').trim();
  const specialBody = waitingBody(waitingState);
  const isConflict =
    waitingState === 'PHONE_CONFLICT' || waitingState === 'MOVED_TO_SIBLING_DEVICE';

  return (
    <View style={styles.wrap}>
      {!isConflict ? (
        <Animated.View style={[styles.loaderHaloWrap, { transform: [{ scale: pulseScale }] }]}>
          <Animated.View style={[styles.loaderRing, { transform: [{ rotate: ringSpin }] }]} />
          <View style={styles.loaderInner}>
            <Ionicons name="phone-portrait-outline" size={28} color={ACCENT} />
          </View>
        </Animated.View>
      ) : (
        <View style={styles.conflictIconWrap}>
          <Ionicons name="information-circle" size={52} color={ACCENT} />
        </View>
      )}

      <View style={styles.amountBadge}>
        <Ionicons name="wallet" size={14} color={ACCENT} />
        <Text style={styles.amountBadgeText}>{selectedAmountDisplay}</Text>
      </View>

      <Text style={styles.title}>{waitingTitle(waitingState)}</Text>

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
          <Text style={styles.statusBadgeText}>{statusLabel(currentStep, waitingState)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        {specialBody ? (
          <Text style={styles.bodyText}>{specialBody}</Text>
        ) : (
          <>
            <Text style={styles.bodyText}>
              Tafadhali thibitisha malipo yanayoonekana kwenye simu yako kwa kuweka namba yako ya siri
              (PIN).
            </Text>
            <Text style={styles.bodyEmphasis}>
              Baada ya kuthibitisha, kifurushi kitaanza kutumika moja kwa moja.
            </Text>
          </>
        )}
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
                    <Ionicons name="checkmark" size={10} color="#0F172A" />
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
        <Ionicons name="time-outline" size={16} color={ACCENT} />
        <View style={styles.estimateTextCol}>
          <Text style={styles.estimateTitle}>Muda unaokadiriwa</Text>
          <Text style={styles.countdown}>
            {remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '--:--'}
          </Text>
        </View>
      </View>

      {orderId ? (
        <View style={styles.orderCard}>
          <View style={styles.orderCardHeader}>
            <Ionicons name="receipt-outline" size={14} color={ACCENT} />
            <Text style={styles.orderCardTitle}>Order ID</Text>
          </View>
          <Text style={styles.orderCardValue} selectable numberOfLines={1}>
            {orderId}
          </Text>
        </View>
      ) : null}

      <View style={styles.tipsCard}>
        <Text style={styles.tipsHeading}>Muhimu</Text>
        {TIPS.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingVertical: 0,
    paddingBottom: 4,
    gap: 8,
  },
  loaderHaloWrap: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 16,
    elevation: 10,
  },
  loaderRing: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: 'rgba(250,204,21,0.16)',
    borderTopColor: ACCENT,
    borderRightColor: ACCENT,
  },
  loaderInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#161B23',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.22)',
  },
  conflictIconWrap: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  amountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: 'rgba(250,204,21,0.12)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.35)',
  },
  amountBadgeText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.2,
    lineHeight: 22,
    paddingHorizontal: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#1A1F28',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  providerLogo: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  providerIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerIconText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  providerBadgeText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.25)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  statusBadgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
    gap: 6,
  },
  bodyText: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 17,
  },
  bodyEmphasis: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  progressCard: {
    backgroundColor: '#161A22',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeading: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
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
    shadowRadius: 6,
    elevation: 3,
  },
  progressDotNum: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '800',
  },
  progressDotNumActive: {
    color: ACCENT,
  },
  progressLabel: {
    flex: 1,
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
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
    height: 10,
    marginLeft: 9,
    marginVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
  },
  progressLineDone: {
    backgroundColor: 'rgba(74,222,128,0.45)',
  },
  estimateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.15)',
  },
  estimateTextCol: {
    flex: 1,
    gap: 0,
  },
  estimateTitle: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  countdown: {
    color: ACCENT,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    textShadowColor: ACCENT_GLOW,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  orderCard: {
    backgroundColor: '#161A22',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  orderCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  orderCardTitle: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  orderCardValue: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  tipsCard: {
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.18)',
    gap: 6,
    marginBottom: 2,
  },
  tipsHeading: {
    color: SUCCESS,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 0,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  tipText: {
    flex: 1,
    color: '#E5E7EB',
    fontSize: 11,
    lineHeight: 15,
  },
});
