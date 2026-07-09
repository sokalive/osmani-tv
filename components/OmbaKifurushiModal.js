import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import {
  fetchOmbaKifurushiSettings,
  OMBA_KIFURUSHI_DISABLED_MESSAGE_SW,
  submitSubscriptionRequest,
} from '../api/subscriptionRequest';
import {
  getCachedPaymentPlansSync,
  hydratePaymentPlansCacheFromStorage,
  normalizePaymentPlansList,
  refreshPaymentPlansCache,
} from '../lib/paymentPlansCache';
import {
  isValidTanzaniaMobilePhone,
  normalizeTanzaniaMobilePhone,
} from '../lib/tanzaniaPhone';
import { useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const COLORS = {
  background: '#0C0608',
  card: '#151922',
  input: '#1D222C',
  yellow: '#FFCB3D',
  yellowDark: '#E5A020',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
  border: 'rgba(255,255,255,0.08)',
  danger: '#F87171',
};

const STEPS = Object.freeze({
  LOADING: 'loading',
  DISABLED: 'disabled',
  PHONE: 'phone',
  PACKAGES: 'packages',
  SUCCESS: 'success',
});

function formatPhoneInput(raw) {
  const norm = normalizeTanzaniaMobilePhone(raw);
  return norm?.local ?? String(raw || '').replace(/[^\d]/g, '').slice(0, 10);
}

function formatPriceTz(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

function formatPlanDuration(plan) {
  const d = String(plan?.duration ?? '').trim();
  if (d) return d.includes('siku') || d.includes('mwezi') ? d : `${d} siku`;
  return '';
}

/**
 * OMBA KIFURUSHI CHAKO — admin subscription request flow.
 */
export default function OmbaKifurushiModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const { availablePlans, reverifySubscription } = useOsmaniApp();
  const [step, setStep] = useState(STEPS.LOADING);
  const [phone, setPhone] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disabledMessage, setDisabledMessage] = useState(OMBA_KIFURUSHI_DISABLED_MESSAGE_SW);
  const submitLockRef = useRef(false);

  useRegisterBlockingSheet('lifecycle-omba-kifurushi', visible);

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const cardMaxHeight = windowHeight * 0.82;

  const runEnterAnim = useCallback(() => {
    opacity.setValue(0);
    scale.setValue(0.92);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 8, tension: 80, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale]);

  const loadPlans = useCallback(async () => {
    const cached = getCachedPaymentPlansSync();
    if (cached?.length) {
      setPlans(cached);
    } else if (Array.isArray(availablePlans) && availablePlans.length > 0) {
      const fromContext = normalizePaymentPlansList(availablePlans);
      if (fromContext.length) setPlans(fromContext);
    } else {
      const hydrated = await hydratePaymentPlansCacheFromStorage();
      if (hydrated?.length) setPlans(hydrated);
    }

    const fresh = (await refreshPaymentPlansCache({ reason: 'omba-kifurushi' })) ?? [];
    const list =
      fresh.length > 0
        ? fresh
        : getCachedPaymentPlansSync() ?? normalizePaymentPlansList(availablePlans ?? []);
    setPlans(list);
    return list;
  }, [availablePlans]);

  const resetState = useCallback(() => {
    setStep(STEPS.LOADING);
    setPhone('');
    setSelectedPlanId('');
    setError('');
    setBusy(false);
    submitLockRef.current = false;
  }, []);

  useEffect(() => {
    if (!visible) {
      resetState();
      return;
    }
    runEnterAnim();
    void (async () => {
      try {
        const [settings, loadedPlans] = await Promise.all([
          fetchOmbaKifurushiSettings(),
          loadPlans(),
        ]);
        if (!settings.enabled) {
          setDisabledMessage(settings.disabledMessageSw);
          setStep(STEPS.DISABLED);
          return;
        }
        if (!loadedPlans.length) {
          setError('Hakuna vifurushi vinavyopatikana kwa sasa.');
          setStep(STEPS.PHONE);
          return;
        }
        setStep(STEPS.PHONE);
      } catch {
        setError('Imeshindwa kupakia huduma. Jaribu tena.');
        setStep(STEPS.PHONE);
      }
    })();
  }, [visible, runEnterAnim, resetState, loadPlans]);

  useEffect(() => {
    if (!visible) return undefined;
    const offSettings = subscribeRealtimeEvent('omba_kifurushi_settings_changed', (payload) => {
      const enabled =
        payload?.omba_kifurushi_enabled !== false && payload?.ombaKifurushiEnabled !== false;
      if (!enabled) {
        setDisabledMessage(
          String(payload?.disabled_message_sw ?? payload?.disabledMessageSw ?? '').trim() ||
            OMBA_KIFURUSHI_DISABLED_MESSAGE_SW,
        );
        setStep(STEPS.DISABLED);
      }
    });
    const offRequest = subscribeRealtimeEvent('subscription_request_updated', (payload) => {
      const status = String(payload?.status ?? '').toUpperCase();
      if (status === 'APPROVED') {
        void reverifySubscription('sse:subscription_request_updated');
      }
    });
    return () => {
      offSettings();
      offRequest();
    };
  }, [visible, reverifySubscription]);

  const selectedPlan = useMemo(
    () => plans.find((p) => String(p.id) === String(selectedPlanId)) ?? null,
    [plans, selectedPlanId],
  );

  const isPhoneValid = isValidTanzaniaMobilePhone(phone);

  const handleContinuePhone = () => {
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu (mfano 0712345678)');
      return;
    }
    if (!plans.length) {
      Alert.alert('', 'Hakuna vifurushi vinavyopatikana kwa sasa.');
      return;
    }
    setError('');
    setStep(STEPS.PACKAGES);
  };

  const handleSubmit = async () => {
    if (submitLockRef.current || busy) return;
    if (!selectedPlan?.id) {
      Alert.alert('', 'Chagua kifurushi');
      return;
    }
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu');
      return;
    }
    submitLockRef.current = true;
    setBusy(true);
    setError('');
    try {
      const identity = await getDeviceIdentity();
      const result = await submitSubscriptionRequest({
        phone,
        planId: selectedPlan.id,
        deviceId: identity.deviceId,
      });
      if (!result.ok) {
        if (result.httpStatus === 409) {
          setError('Tayari una ombi linalosubiri. Tafadhali subiri majibu ya Admin.');
        } else if (result.httpStatus === 403) {
          setDisabledMessage(result.message);
          setStep(STEPS.DISABLED);
        } else {
          setError(result.message || 'Imeshindwa kutuma ombi. Jaribu tena.');
        }
        return;
      }
      setStep(STEPS.SUCCESS);
    } catch (e) {
      const msg = String(e?.message ?? '');
      if (/network|fetch|timeout/i.test(msg)) {
        setError('Hakuna mtandao. Angalia muunganisho na ujaribu tena.');
      } else {
        setError('Imeshindwa kutuma ombi. Jaribu tena.');
      }
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  };

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} accessibilityLabel="Funga" />
        <Animated.View style={[styles.cardWrap, { opacity, transform: [{ scale }] }]}>
          <BlurView intensity={40} tint="dark" style={styles.blur}>
            <View style={[styles.card, { maxHeight: cardMaxHeight }]}>
              <View style={styles.header}>
                <Text style={styles.title}>OMBA KIFURUSHI CHAKO</Text>
                <Pressable onPress={handleClose} hitSlop={12} disabled={busy}>
                  <Ionicons name="close" size={24} color={COLORS.mutedText} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {step === STEPS.LOADING ? (
                  <View style={styles.centerBlock}>
                    <ActivityIndicator color={COLORS.yellow} size="large" />
                    <Text style={styles.muted}>Inapakia…</Text>
                  </View>
                ) : null}

                {step === STEPS.DISABLED ? (
                  <View style={styles.centerBlock}>
                    <Ionicons name="lock-closed-outline" size={40} color={COLORS.mutedText} />
                    <Text style={styles.disabledText}>{disabledMessage}</Text>
                  </View>
                ) : null}

                {step === STEPS.SUCCESS ? (
                  <View style={styles.centerBlock}>
                    <Ionicons name="checkmark-circle" size={48} color={COLORS.yellow} />
                    <Text style={styles.successText}>
                      Ombi lako limetumwa kwa Admin. Tafadhali subiri majibu.
                    </Text>
                  </View>
                ) : null}

                {step === STEPS.PHONE ? (
                  <>
                    <Text style={styles.fieldLabel}>WEKA NAMBA YA SIMU</Text>
                    <TextInput
                      style={styles.input}
                      value={phone}
                      onChangeText={(t) => setPhone(formatPhoneInput(t))}
                      placeholder="0712345678"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                      maxLength={10}
                      editable={!busy}
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <Pressable
                      style={[styles.btnOuter, !isPhoneValid && styles.btnDisabled]}
                      onPress={handleContinuePhone}
                      disabled={!isPhoneValid || busy}
                    >
                      <LinearGradient
                        colors={[COLORS.yellow, COLORS.yellowDark]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.btnGradient}
                      >
                        <Text style={styles.btnTextDark}>ENDELEA</Text>
                      </LinearGradient>
                    </Pressable>
                  </>
                ) : null}

                {step === STEPS.PACKAGES ? (
                  <>
                    <Text style={styles.fieldLabel}>CHAGUA KIFURUSHI</Text>
                    <Text style={styles.phoneHint}>
                      Simu: {normalizeTanzaniaMobilePhone(phone)?.local ?? phone}
                    </Text>
                    {plans.map((plan) => {
                      const selected = String(plan.id) === String(selectedPlanId);
                      return (
                        <Pressable
                          key={plan.id}
                          style={[styles.planRow, selected && styles.planRowSelected]}
                          onPress={() => setSelectedPlanId(String(plan.id))}
                          disabled={busy}
                        >
                          <View style={styles.planInfo}>
                            <Text style={styles.planName}>{plan.name}</Text>
                            <Text style={styles.planMeta}>
                              {formatPlanDuration(plan)} · TSh {formatPriceTz(plan.price)}
                            </Text>
                          </View>
                          {selected ? (
                            <Ionicons name="checkmark-circle" size={22} color={COLORS.yellow} />
                          ) : (
                            <Ionicons name="ellipse-outline" size={22} color={COLORS.mutedText} />
                          )}
                        </Pressable>
                      );
                    })}
                    {selectedPlan ? (
                      <View style={styles.summaryBox}>
                        <Text style={styles.summaryTitle}>{selectedPlan.name}</Text>
                        <Text style={styles.summaryMeta}>
                          Muda: {formatPlanDuration(selectedPlan)}
                        </Text>
                        <Text style={styles.summaryMeta}>
                          Bei: TSh {formatPriceTz(selectedPlan.price)}
                        </Text>
                      </View>
                    ) : null}
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <Pressable
                      style={[styles.btnOuter, (!selectedPlan || busy) && styles.btnDisabled]}
                      onPress={() => void handleSubmit()}
                      disabled={!selectedPlan || busy}
                    >
                      <LinearGradient
                        colors={[COLORS.yellow, COLORS.yellowDark]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.btnGradient}
                      >
                        {busy ? (
                          <ActivityIndicator color="#111827" />
                        ) : (
                          <Text style={styles.btnTextDark}>TUMA OMBI KWA ADMIN</Text>
                        )}
                      </LinearGradient>
                    </Pressable>
                    <Pressable style={styles.backLink} onPress={() => setStep(STEPS.PHONE)} disabled={busy}>
                      <Text style={styles.backLinkText}>Rudi — badilisha namba</Text>
                    </Pressable>
                  </>
                ) : null}
              </ScrollView>
            </View>
          </BlurView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  cardWrap: { width: '88%', maxWidth: 392 },
  blur: { borderRadius: 20, overflow: 'hidden' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '800', flex: 1, paddingRight: 8 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 8 },
  fieldLabel: {
    color: COLORS.yellow,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  input: {
    backgroundColor: COLORS.input,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: COLORS.white,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  phoneHint: { color: COLORS.mutedText, fontSize: 13, marginBottom: 12 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.input,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  planRowSelected: { borderColor: 'rgba(255,203,61,0.5)' },
  planInfo: { flex: 1 },
  planName: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  planMeta: { color: COLORS.mutedText, fontSize: 13, marginTop: 4 },
  summaryBox: {
    marginTop: 8,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,203,61,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.25)',
  },
  summaryTitle: { color: COLORS.white, fontSize: 15, fontWeight: '800' },
  summaryMeta: { color: COLORS.mutedText, fontSize: 13, marginTop: 4 },
  btnOuter: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  btnDisabled: { opacity: 0.5 },
  btnGradient: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  btnTextDark: { color: '#111827', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  errorText: { color: COLORS.danger, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  disabledText: {
    color: COLORS.mutedText,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
  },
  successText: {
    color: COLORS.white,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
  },
  centerBlock: { alignItems: 'center', paddingVertical: 24 },
  muted: { color: COLORS.mutedText, marginTop: 12 },
  backLink: { marginTop: 14, alignItems: 'center' },
  backLinkText: { color: COLORS.mutedText, fontSize: 13 },
});
