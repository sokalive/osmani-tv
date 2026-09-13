import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { PAYMENT } from '../lib/paymentFlowTheme';

const ACCENT = PAYMENT.accent;
const TEXT_MUTED = PAYMENT.textMuted;

const PROGRESS_STEPS = [
  { key: 0, label: 'Ombi Limetumwa' },
  { key: 1, label: 'Inasubiri PIN' },
  { key: 2, label: 'Uthibitisho Malipo' },
  { key: 3, label: 'Uanzishaji Kifurushi' },
];

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function statusLabel(step, appWaitingState) {
  if (appWaitingState === 'PROVIDER_CONFIRMED_ACTIVATING') return 'Inaanzisha Kifurushi';
  if (appWaitingState === 'RETRYING') return 'Inajaribu Tena';
  if (appWaitingState === 'PHONE_CONFLICT') return 'Namba Inatumika';
  if (appWaitingState === 'MOVED_TO_SIBLING_DEVICE') return 'Kifurushi Kimehamishwa';
  if (step >= 3) return 'Inaanzisha Kifurushi';
  if (step >= 2) return 'Uthibitisho Malipo';
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

function providerTabLabel(checkoutProvider) {
  const p = String(checkoutProvider ?? '').trim().toLowerCase();
  if (p.includes('aura')) return 'AuraxPay';
  if (p.includes('zeno')) return 'ZenoPay';
  if (p.includes('sonic')) return 'SonicPesa';
  return 'SonicPesa';
}

/** Decorative dashed ring — progress from remaining vs total wait window. */
function DottedCountdownRing({ progress, children }) {
  const dots = 36;
  const size = 112;
  const radius = 48;
  const cx = size / 2;
  const cy = size / 2;
  const lit = Math.round(Math.max(0, Math.min(1, progress)) * dots);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: dots }).map((_, i) => {
        const angle = (i / dots) * Math.PI * 2 - Math.PI / 2;
        const x = cx + radius * Math.cos(angle) - 2.5;
        const y = cy + radius * Math.sin(angle) - 2.5;
        const active = i < lit;
        return (
          <View
            key={`dot-${i}`}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: active ? ACCENT : 'rgba(255,255,255,0.28)',
            }}
          />
        );
      })}
      {children}
    </View>
  );
}

function PinPhoneIllustration() {
  return (
    <View style={styles.phoneFrame}>
      <View style={styles.phoneScreen}>
        <View style={styles.pinDotsRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.pinDot} />
          ))}
        </View>
        <View style={styles.keypad}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, null].map((n, idx) => (
            <View key={idx} style={[styles.key, n == null && styles.keyEmpty]}>
              {n != null ? <Text style={styles.keyText}>{n}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Premium payment waiting UI (step 3 only — no checkout logic).
 */
export default function PaymentWaitingStep({
  selectedAmountDisplay,
  orderId,
  remainingSeconds,
  paymentProgressStep,
  appWaitingState,
  ringSpin,
  checkoutProvider,
  totalWaitSeconds = 180,
  onSupportPress,
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
    outputRange: [1, 1.03],
  });

  const currentStep = Math.min(Math.max(paymentProgressStep, 0), 3);
  const waitingState = String(appWaitingState ?? '').trim();
  const specialBody = waitingBody(waitingState);
  const isConflict =
    waitingState === 'PHONE_CONFLICT' || waitingState === 'MOVED_TO_SIBLING_DEVICE';
  const countdown = remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '--:--';
  const total = Math.max(1, Number(totalWaitSeconds) || 180);
  const progress = Math.max(0, Math.min(1, remainingSeconds / total));
  const activeTabLabel = statusLabel(currentStep, waitingState);
  const leftTab = providerTabLabel(checkoutProvider);

  const copyOrderId = async () => {
    if (!orderId) return;
    try {
      await Clipboard.setStringAsync(String(orderId));
    } catch {
      /* ignore */
    }
  };

  const stepNodes = useMemo(
    () =>
      PROGRESS_STEPS.map((item, index) => {
        const done = currentStep > item.key;
        const active = currentStep === item.key;
        return (
          <React.Fragment key={item.key}>
            <View style={styles.stepCol}>
              <View
                style={[
                  styles.stepCircle,
                  done && styles.stepCircleDone,
                  active && styles.stepCircleActive,
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color="#111" />
                ) : (
                  <Text style={[styles.stepNum, active && styles.stepNumActive]}>
                    {item.key + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  done && styles.stepLabelDone,
                  active && styles.stepLabelActive,
                ]}
                numberOfLines={2}
              >
                {item.label}
              </Text>
            </View>
            {index < PROGRESS_STEPS.length - 1 ? (
              <View style={[styles.stepConnector, (done || active) && styles.stepConnectorActive]} />
            ) : null}
          </React.Fragment>
        );
      }),
    [currentStep],
  );

  return (
    <View style={styles.wrap}>
      {!isConflict ? (
        <Animated.View style={[styles.timerBlock, { transform: [{ scale: pulseScale }] }]}>
          <DottedCountdownRing progress={1 - progress}>
            <Text style={styles.timerValue}>{countdown}</Text>
          </DottedCountdownRing>
          <Text style={styles.timerCaption}>Muda unaokadiriwa</Text>
        </Animated.View>
      ) : (
        <View style={styles.conflictIconWrap}>
          <Ionicons name="information-circle" size={52} color={ACCENT} />
        </View>
      )}

      <View style={styles.amountBadge}>
        <Ionicons name="wallet-outline" size={14} color={ACCENT} />
        <Text style={styles.amountBadgeText}>{selectedAmountDisplay}</Text>
      </View>

      <Text style={styles.title}>{waitingTitle(waitingState)}</Text>

      <View style={styles.segment}>
        <View style={styles.segmentInactive}>
          <Text style={styles.segmentInactiveText}>{leftTab}</Text>
        </View>
        <View style={styles.segmentActive}>
          <Text style={styles.segmentActiveText}>{activeTabLabel}</Text>
        </View>
      </View>

      <View style={styles.card}>
        {specialBody ? (
          <Text style={styles.bodyText}>{specialBody}</Text>
        ) : (
          <>
            <Text style={styles.bodyText}>
              Tafadhali thibitisha malipo kwenye simu yako kwa kuweka namba yako ya siri (PIN).
            </Text>
            <Text style={styles.bodyEmphasis}>
              Baada ya kuthibitisha, kifurushi kitaanza kutumika moja kwa moja.
            </Text>
          </>
        )}
      </View>

      <View style={styles.progressTrack}>{stepNodes}</View>

      <View style={styles.metaRow}>
        <View style={styles.metaCard}>
          <Ionicons name="time-outline" size={16} color={ACCENT} />
          <Text style={styles.metaLabel}>Muda unaokadiriwa</Text>
          <Text style={styles.metaValueRed}>{countdown}</Text>
        </View>
        <View style={styles.metaCard}>
          <View style={styles.metaCardHeader}>
            <Ionicons name="document-text-outline" size={16} color={ACCENT} />
            {orderId ? (
              <Pressable onPress={copyOrderId} hitSlop={8} accessibilityLabel="Copy Order ID">
                <Ionicons name="copy-outline" size={15} color={ACCENT} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.metaLabel}>Order ID</Text>
          <Text style={styles.metaOrderId} numberOfLines={2} selectable>
            {orderId || '—'}
          </Text>
        </View>
      </View>

      {!isConflict ? (
        <View style={styles.howCard}>
          <PinPhoneIllustration />
          <View style={styles.howTextCol}>
            <Text style={styles.howTitle}>Jinsi ya kuthibitisha malipo</Text>
            <Text style={styles.howBody}>
              Angalia Ujumbe mwenye simu yako Unao Kuhitaji kuweka Namba Yako Ya siri Kisha weka
              namba Yako Ya Siri Kuthibitisha malipo.
            </Text>
          </View>
        </View>
      ) : null}

      <Pressable style={styles.supportRow} onPress={onSupportPress}>
        <View style={styles.supportIcon}>
          <Ionicons name="headset-outline" size={18} color={ACCENT} />
        </View>
        <View style={styles.supportTextCol}>
          <Text style={styles.supportTitle}>Tatizo la malipo?</Text>
          <Text style={styles.supportSub}>Wasiliana nasi kwa msaada wa haraka</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
      </Pressable>

      <View style={styles.footerHint}>
        <Ionicons name="shield-checkmark" size={14} color={ACCENT} />
        <Text style={styles.footerHintText}>Thibitisha malipo kwa PIN yako.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingBottom: 4,
    gap: 10,
  },
  timerBlock: {
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 2,
  },
  timerValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timerCaption: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
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
    backgroundColor: 'transparent',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: ACCENT,
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
    lineHeight: 24,
    paddingHorizontal: 4,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: PAYMENT.cardBg,
    borderWidth: 1,
    borderColor: PAYMENT.cardBorder,
  },
  segmentInactive: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAYMENT.cardBgElevated,
  },
  segmentActive: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
  },
  segmentInactiveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  segmentActiveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  card: {
    backgroundColor: PAYMENT.cardBg,
    borderRadius: PAYMENT.cardRadius,
    padding: 14,
    borderWidth: 1,
    borderColor: PAYMENT.cardBorder,
    gap: 8,
  },
  bodyText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
  },
  bodyEmphasis: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  progressTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  stepCol: {
    width: 68,
    alignItems: 'center',
    gap: 6,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  stepCircleDone: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  stepCircleActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  stepNum: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '800',
  },
  stepNumActive: {
    color: '#FFFFFF',
  },
  stepLabel: {
    color: TEXT_MUTED,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 12,
  },
  stepLabelDone: {
    color: '#FFFFFF',
  },
  stepLabelActive: {
    color: ACCENT,
    fontWeight: '800',
  },
  stepConnector: {
    flex: 1,
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dotted',
    borderColor: 'rgba(255,255,255,0.25)',
    marginTop: 12,
    marginHorizontal: -4,
  },
  stepConnectorActive: {
    borderColor: ACCENT,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metaCard: {
    flex: 1,
    backgroundColor: PAYMENT.cardBg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: PAYMENT.cardBorder,
    gap: 4,
    minHeight: 92,
  },
  metaCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontWeight: '600',
  },
  metaValueRed: {
    color: ACCENT,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metaOrderId: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 14,
  },
  howCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: PAYMENT.cardBg,
    borderRadius: PAYMENT.cardRadius,
    padding: 12,
    borderWidth: 1,
    borderColor: PAYMENT.cardBorder,
    alignItems: 'center',
  },
  howTextCol: {
    flex: 1,
    gap: 6,
  },
  howTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  howBody: {
    color: PAYMENT.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  phoneFrame: {
    width: 72,
    height: 110,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2A2A2E',
    backgroundColor: '#0A0A0A',
    padding: 4,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  phoneScreen: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#111',
    paddingTop: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  pinDotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  pinDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
  },
  key: {
    width: '30%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    opacity: 0,
  },
  keyText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '700',
  },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: PAYMENT.cardBg,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: PAYMENT.cardBorder,
  },
  supportIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAYMENT.accentSoft,
  },
  supportTextCol: {
    flex: 1,
    gap: 2,
  },
  supportTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  supportSub: {
    color: TEXT_MUTED,
    fontSize: 11,
  },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 2,
    paddingBottom: 4,
  },
  footerHintText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
});
