import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import EventSource from 'react-native-sse';
import {
  createPayment,
  fetchSubscription,
  getPaymentStatus,
  getPlans,
} from '../api/payment';
import { BASE_URL } from '../api';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { formatSubscriptionExpiry } from '../lib/formatExpiry';

const ACCENT = '#FACC15';
const CARD_BG = '#1E222B';
const CARD_BG_ACTIVE = '#2A2F3A';
const TEXT_MUTED = '#9CA3AF';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MODAL_MAX_HEIGHT = Math.round(WINDOW_HEIGHT * 0.85);

const POLL_MS = 3000;

const NETWORKS = ['Tigo', 'M-Pesa', 'Airtel', 'HaloPesa'];

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatPriceTz(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  try {
    return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(num);
  } catch {
    return String(Math.round(num));
  }
}

function normalizePlanRow(raw) {
  const active = raw?.is_active === true || raw?.isActive === true;
  return {
    id: String(raw?.id ?? raw?.plan_id ?? '').trim(),
    name: String(raw?.name ?? raw?.title ?? '').trim(),
    price: Number(raw?.price ?? raw?.amount ?? 0),
    duration: String(raw?.duration ?? raw?.duration_label ?? raw?.duration_text ?? '').trim(),
    isActive: active,
  };
}

/**
 * @param {{ visible: boolean; onClose: () => void; onUnlockSuccess?: () => void }} props
 */
export default function PremiumModal({ visible, onClose, onUnlockSuccess, channelName = 'Chaneli Uliyofungua' }) {
  const insets = useSafeAreaInsets();
  const { refreshSubscription, unlockChannels } = useOsmaniApp();
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [orderId, setOrderId] = useState(null);
  const [waitingDeviceId, setWaitingDeviceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [successExpiresAt, setSuccessExpiresAt] = useState(null);
  const [finalizingSuccess, setFinalizingSuccess] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const pollTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const sseRef = useRef(null);
  const doneRef = useRef(false);

  const animateStepChange = useCallback(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(12);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      try {
        sseRef.current.close();
      } catch {
        // no-op
      }
      sseRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    clearTimers();
    doneRef.current = false;
    setStep(1);
    setPlans([]);
    setPlansError('');
    setSelectedPlan(null);
    setPhoneNumber('');
    setRemainingSeconds(0);
    setOrderId(null);
    setWaitingDeviceId('');
    setSubmitting(false);
    setFailureReason('');
    setSuccessExpiresAt(null);
    setFinalizingSuccess(false);
    fadeAnim.setValue(1);
    slideAnim.setValue(0);
  }, [visible, clearTimers, fadeAnim, slideAnim]);

  useEffect(() => {
    if (!visible) {
      clearTimers();
      closeSse();
      doneRef.current = false;
    }
  }, [visible, clearTimers, closeSse]);

  useEffect(() => {
    animateStepChange();
  }, [step, animateStepChange]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    (async () => {
      setPlansLoading(true);
      setPlansError('');
      try {
        const raw = await getPlans();
        if (cancelled) return;
        const list = Array.isArray(raw) ? raw.map(normalizePlanRow).filter((p) => p.isActive === true) : [];
        setPlans(list);
        setSelectedPlan((prev) => {
          if (prev && list.some((x) => x.id === prev.id)) return prev;
          return list[0] ?? null;
        });
      } catch (e) {
        if (!cancelled) setPlansError(e?.message ?? 'Imeshindwa kupakia mipango');
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  /** When modal opens, always sync subscription from server (do not trust stale context). */
  useEffect(() => {
    if (!visible) return undefined;
    void refreshSubscription();
  }, [visible, refreshSubscription]);

  /** After ZenoPay reports SUCCESS: show success UI only; global unlock runs on ENDELEA via `handleCompleted`. */
  const moveToSuccessStep = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    closeSse();
    try {
      const { deviceId } = await getDeviceIdentity();
      const sub = await fetchSubscription(deviceId);
      setSuccessExpiresAt(sub.expiresAt);
    } catch {
      setSuccessExpiresAt(null);
    }
    setStep(4);
  }, [clearTimers, closeSse]);

  /** ENDELEA: always await fresh API via context; branch only on returned object (never stale context). */
  const handleCompleted = useCallback(async () => {
    setFinalizingSuccess(true);
    try {
      const subscription = await refreshSubscription();
      console.log('AFTER REFRESH:', subscription);
      console.log('SUBSCRIPTION AFTER CLICK:', subscription);
      if (subscription?.isActive === true) {
        unlockChannels(subscription);
        onUnlockSuccess?.();
        await new Promise((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve(null));
        });
        onClose?.();
      } else {
        Alert.alert('Kifurushi', 'Sub bado haija-activate, jaribu tena sekunde chache');
      }
    } catch (e) {
      Alert.alert('Kifurushi', e?.message ?? 'Imeshindwa kusasisha kifurushi');
    } finally {
      setFinalizingSuccess(false);
    }
  }, [refreshSubscription, unlockChannels, onUnlockSuccess, onClose]);

  const handleFailed = useCallback(
    (reason) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      setFailureReason(reason || 'Malipo hayajafanikiwa');
      setStep(5);
    },
    [clearTimers],
  );

  const pollOnce = useCallback(
    async (oid) => {
      if (doneRef.current) return;
      try {
        const latestSubscription = await refreshSubscription();
        if (latestSubscription?.isActive === true) {
          await moveToSuccessStep();
          return;
        }

        const { status, reason } = await getPaymentStatus(oid);
        if (doneRef.current) return;
        if (status === 'SUCCESS') {
          await moveToSuccessStep();
          return;
        }
        if (status === 'FAILED') {
          handleFailed(reason);
        }
      } catch {
        // transient network — keep polling
      }
    },
    [moveToSuccessStep, handleFailed, refreshSubscription],
  );

  useEffect(() => {
    if (!visible || step !== 3 || !orderId || doneRef.current) return undefined;

    (async () => {
      await pollOnce(orderId);
    })();

    pollTimerRef.current = setInterval(() => {
      if (doneRef.current) return;
      pollOnce(orderId);
    }, POLL_MS);

    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);

    return () => clearTimers();
  }, [visible, step, orderId, clearTimers, pollOnce, handleFailed]);

  useEffect(() => {
    if (!visible || step !== 3 || !waitingDeviceId || doneRef.current) return undefined;
    closeSse();
    const url = `${BASE_URL}/api/subscription-stream?device_id=${encodeURIComponent(waitingDeviceId)}`;
    const stream = new EventSource(url, { pollingInterval: 0 });
    sseRef.current = stream;

    const onMessage = (event) => {
      if (doneRef.current) return;
      try {
        const payload = JSON.parse(event?.data ?? '{}');
        const isActive = payload?.isActive === true || payload?.active === true;
        const expiresAt = payload?.expiresAt ?? payload?.expires_at ?? null;
        const expTs = expiresAt ? Date.parse(String(expiresAt)) : NaN;
        const isValid = Number.isFinite(expTs) && expTs > Date.now();
        if (isActive && isValid) {
          unlockChannels({ isActive: true, expiresAt: String(expiresAt) });
          void moveToSuccessStep();
        }
      } catch {
        // ignore malformed stream payloads
      }
    };

    stream.addEventListener('message', onMessage);
    stream.addEventListener('error', () => {
      // Keep polling fallback active; no modal failure on SSE issues.
    });

    return () => {
      try {
        stream.removeAllEventListeners();
      } catch {
        // no-op
      }
      closeSse();
    };
  }, [visible, step, waitingDeviceId, closeSse, unlockChannels, moveToSuccessStep]);

  const handleCancel = () => {
    clearTimers();
    onClose?.();
  };

  const isPhoneValid =
    !!phoneNumber && phoneNumber.length === 10 && phoneNumber.startsWith('0');

  const selectedAmountDisplay =
    selectedPlan && Number.isFinite(selectedPlan.price)
      ? `TSh ${formatPriceTz(selectedPlan.price)}`
      : 'TSh —';

  const handleStep2Pay = async () => {
    console.log('PAYMENT TRIGGERED');
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu');
      return;
    }
    if (!selectedPlan?.id) {
      Alert.alert('', 'Chagua mpango');
      return;
    }
    setSubmitting(true);
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const { order_id: oid, expiresInSeconds } = await createPayment({
        phone: phoneNumber.replace(/\s/g, ''),
        plan_id: selectedPlan.id,
        amount: selectedPlan.price,
        device_id: deviceId,
        device_fingerprint: deviceFingerprint,
      });
      doneRef.current = false;
      setWaitingDeviceId(deviceId);
      setOrderId(oid);
      const wait =
        typeof expiresInSeconds === 'number' && expiresInSeconds > 0
          ? Math.floor(expiresInSeconds)
          : 0;
      setRemainingSeconds(wait);
      setStep(3);
    } catch (e) {
      Alert.alert('Malipo', e?.message ?? 'Imeshindwa kuanzisha malipo');
    } finally {
      setSubmitting(false);
    }
  };

  const goStep2 = () => {
    if (!selectedPlan) {
      Alert.alert('', 'Hakuna mpango wa kulipa');
      return;
    }
    setStep(2);
  };

  const handleRetry = () => {
    doneRef.current = false;
    setFailureReason('');
    setOrderId(null);
    setRemainingSeconds(0);
    setStep(2);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { height: MODAL_MAX_HEIGHT, maxHeight: MODAL_MAX_HEIGHT }]}>
            <SafeAreaView
              edges={['top', 'bottom']}
              style={step === 2 ? [styles.sheetSafe, styles.sheetSafeCompactBottom] : styles.sheetSafe}
            >
              <View style={styles.sheetBody}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.modalScroll}
                  contentContainerStyle={
                    step === 2
                      ? [styles.modalScrollContentStep2Centered]
                      : styles.modalScrollContent
                  }
                  bounces={false}
                >
                  <View style={styles.handleBar} />
                  <Animated.View
                    style={[
                      {
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }],
                      },
                      step === 2 && styles.step2AnimatedFill,
                    ]}
                  >
                    {step === 1 && (
                      <View>
                        <Text style={styles.title}>Fungua Premium</Text>
                        <Text style={styles.subtitle} numberOfLines={1}>
                          {channelName}
                        </Text>
                        {plansLoading ? (
                          <ActivityIndicator size="large" color={ACCENT} style={styles.plansSpinner} />
                        ) : null}
                        {plansError ? <Text style={styles.errorText}>{plansError}</Text> : null}
                        {!plansLoading && !plansError && plans.length === 0 ? (
                          <Text style={styles.mutedCenter}>Hakuna mipango inayopatikana kwa sasa.</Text>
                        ) : null}
                        {plans.map((plan) => {
                          const selected = selectedPlan?.id === plan.id;
                          return (
                            <Pressable
                              key={plan.id}
                              onPress={() => setSelectedPlan(plan)}
                              style={[styles.planRow, selected && styles.planRowSelected]}
                            >
                              <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
                                {selected ? <View style={styles.radioInner} /> : null}
                              </View>
                              <View style={styles.planTextCol}>
                                <Text style={styles.planLabel}>{plan.name}</Text>
                                <Text style={styles.planMeta}>{plan.duration || '—'}</Text>
                                <Text style={styles.planPrice}>TSh {formatPriceTz(plan.price)}</Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}

                    {step === 2 && (
                      <View style={styles.step2OuterPadding}>
                        <View style={styles.step2TopSection}>
                          <Text style={[styles.title, styles.step2GapClear]}>Weka Namba ya Simu</Text>
                          <Text style={styles.subtitleNetworks}>Tigo, M-Pesa, Airtel, HaloPesa</Text>
                          <TextInput
                            style={[styles.input, styles.step2GapClear]}
                            placeholder="0712345678"
                            placeholderTextColor="#6B7280"
                            keyboardType="phone-pad"
                            maxLength={10}
                            value={phoneNumber}
                            onChangeText={setPhoneNumber}
                          />
                          <Text style={[styles.networksLabel, styles.step2GapClear]}>Mitandao inayokubaliwa</Text>
                          <View style={[styles.networksRow, styles.step2GapClear]}>
                            {NETWORKS.map((n) => (
                              <View key={n} style={styles.networkChip}>
                                <Text style={styles.networkChipText}>{n}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                        <View style={styles.step2FlexSpacer} />
                        <View style={styles.step2BottomSection}>
                          <Pressable
                            disabled={!isPhoneValid || submitting}
                            style={[
                              styles.cta,
                              styles.ctaDockBtn,
                              (!isPhoneValid || submitting) && styles.ctaDisabled,
                            ]}
                            onPress={handleStep2Pay}
                          >
                            {submitting ? (
                              <ActivityIndicator color="#111827" />
                            ) : (
                              <Text style={styles.ctaText}>LIPIA SASA</Text>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {step === 3 && (
                      <View style={styles.step3Wrap}>
                        <ActivityIndicator size="large" color={ACCENT} style={styles.spinner} />
                        <Text style={styles.waitTitle}>Inasubiri uthibitisho wa malipo</Text>
                        <Text style={styles.waitPin}>
                          Thibitisha malipo ya {selectedAmountDisplay} kwenye simu yako (PIN).
                        </Text>
                        <Text style={styles.countdown}>{remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '--:--'}</Text>
                        <Text style={styles.orderHint} numberOfLines={1}>
                          {orderId ? `Order: ${orderId}` : ''}
                        </Text>
                      </View>
                    )}

                    {step === 4 && (
                      <View style={styles.resultWrap}>
                        <Text style={styles.successIcon}>✓</Text>
                        <Text style={styles.successTitle}>Malipo yamefanikiwa</Text>
                        <Text style={styles.successBody}>
                          Kifurushi chako kinaisha:{'\n'}
                          <Text style={styles.successHighlight}>
                            {formatSubscriptionExpiry(successExpiresAt)}
                          </Text>
                        </Text>
                        <Pressable
                          style={[styles.cta, styles.resultCta, finalizingSuccess && styles.ctaDisabled]}
                          disabled={finalizingSuccess}
                          onPress={() => void handleCompleted()}
                        >
                          {finalizingSuccess ? (
                            <ActivityIndicator color="#111827" />
                          ) : (
                            <Text style={styles.ctaText}>ENDELEA</Text>
                          )}
                        </Pressable>
                      </View>
                    )}

                    {step === 5 && (
                      <View style={styles.resultWrap}>
                        <Text style={styles.failIcon}>!</Text>
                        <Text style={styles.failTitle}>Malipo hayajakamilika</Text>
                        <Text style={styles.failBody}>{failureReason}</Text>
                        <Pressable style={[styles.cta, styles.resultCta]} onPress={handleRetry}>
                          <Text style={styles.ctaText}>JARIBU TENA</Text>
                        </Pressable>
                        <Pressable style={[styles.cancelBtn, styles.resultSecondary]} onPress={handleCancel}>
                          <Text style={styles.cancelBtnText}>FUNGA</Text>
                        </Pressable>
                      </View>
                    )}
                  </Animated.View>
                </ScrollView>
                <View
                  style={styles.ctaDock}
                  pointerEvents={step === 1 || step === 3 ? 'box-none' : 'none'}
                >
                  {step === 1 ? (
                    <Pressable
                      style={[styles.cta, styles.ctaDockBtn, (!selectedPlan || plansLoading) && styles.ctaDisabled]}
                      disabled={!selectedPlan || plansLoading}
                      onPress={goStep2}
                    >
                      <Text style={styles.ctaText}>LIPIA — {selectedAmountDisplay}</Text>
                    </Pressable>
                  ) : null}
                  {step === 3 ? (
                    <Pressable style={[styles.cancelBtn, styles.ctaDockBtn]} onPress={handleCancel}>
                      <Text style={styles.cancelBtnText}>GHAIRI</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </SafeAreaView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  centeredWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#16181D',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.15)',
    alignSelf: 'center',
  },
  sheetSafe: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
  sheetBody: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  modalScroll: {
    flex: 1,
    minHeight: 0,
  },
  modalScrollContent: {
    paddingBottom: 100,
  },
  modalScrollContentStep2Centered: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  sheetSafeCompactBottom: {
    paddingBottom: 12,
  },
  step2AnimatedFill: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  step2OuterPadding: {
    flex: 1,
    padding: 16,
    width: '100%',
    minHeight: 0,
  },
  step2TopSection: {
    gap: 16,
  },
  step2FlexSpacer: {
    flex: 1,
    minHeight: 0,
  },
  step2BottomSection: {
    width: '100%',
    marginBottom: 20,
  },
  step2GapClear: {
    marginBottom: 0,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaDock: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 2,
  },
  ctaDockBtn: {
    marginTop: 0,
    marginBottom: 0,
  },
  handleBar: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333842',
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: TEXT_MUTED,
    fontSize: 14,
    marginBottom: 16,
    fontWeight: '500',
  },
  subtitleNetworks: {
    color: TEXT_MUTED,
    fontSize: 13,
    marginTop: -2,
    marginBottom: 10,
  },
  plansSpinner: {
    marginVertical: 24,
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  mutedCenter: {
    color: '#9CA3AF',
    fontSize: 15,
    textAlign: 'center',
    marginVertical: 16,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1.5,
    borderColor: '#343B48',
  },
  planRowSelected: {
    borderColor: ACCENT,
    backgroundColor: CARD_BG_ACTIVE,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4B5563',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: ACCENT,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  planTextCol: {
    flex: 1,
  },
  planLabel: {
    color: '#F3F4F6',
    fontSize: 15,
    fontWeight: '700',
  },
  planMeta: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  planPrice: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  cta: {
    backgroundColor: ACCENT,
    width: '100%',
    minHeight: 56,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 20,
    marginBottom: 20,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  ctaText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#232833',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 17,
    color: '#FFFFFF',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#353D4D',
  },
  networksLabel: {
    color: '#9CA3AF',
    fontSize: 13,
    marginBottom: 10,
  },
  networksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  networkChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#2A2E37',
  },
  networkChipText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  step3Wrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  spinner: {
    marginBottom: 20,
  },
  waitTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  waitPin: {
    color: '#D1D5DB',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 8,
    marginBottom: 14,
  },
  countdown: {
    color: ACCENT,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  orderHint: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
    paddingHorizontal: 12,
  },
  resultWrap: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  successIcon: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 44,
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    backgroundColor: '#4ADE80',
    marginBottom: 10,
  },
  successTitle: {
    color: '#4ADE80',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 14,
    textAlign: 'center',
  },
  successBody: {
    color: '#D1D5DB',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 24,
  },
  successHighlight: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  failTitle: {
    color: '#F87171',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  failIcon: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 44,
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    backgroundColor: '#EF4444',
    marginBottom: 10,
  },
  failBody: {
    color: '#E5E7EB',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  resultCta: {
    marginTop: 0,
    marginBottom: 12,
  },
  resultSecondary: {
    marginTop: 0,
    marginBottom: 8,
  },
  cancelBtn: {
    width: '100%',
    minHeight: 56,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  cancelBtnText: {
    color: '#E5E7EB',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});

