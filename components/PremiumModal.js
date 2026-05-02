import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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

const ACCENT = '#FACC15';

const PLANS = [
  { id: 'w1', label: 'Wiki 1 (7 siku)', amount: 3000, amountFormatted: '3,000' },
  { id: 'm1', label: 'Mwezi 1 (30 siku)', amount: 5000, amountFormatted: '5,000' },
  { id: 'm2', label: 'Miezi 2 (60 siku)', amount: 15000, amountFormatted: '15,000' },
  { id: 'y1', label: 'Mwaka (365 siku)', amount: 40000, amountFormatted: '40,000' },
];

const NETWORKS = ['Tigo', 'M-Pesa', 'Airtel', 'HaloPesa'];

const STEP_WAIT_SECONDS = 120;

const WINDOW_HEIGHT = Dimensions.get('window').height;
/** 85% viewport — modal shell must not extend behind tab bar */
const MODAL_MAX_HEIGHT = Math.round(WINDOW_HEIGHT * 0.85);

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PremiumModal({ visible, onClose, onUnlockSuccess }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState(PLANS[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(STEP_WAIT_SECONDS);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const unlockDoneRef = useRef(false);

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

  useLayoutEffect(() => {
    if (!visible) return;
    setStep(1);
    setSelectedPlan(PLANS[0]);
    setPhoneNumber('');
    setRemainingSeconds(STEP_WAIT_SECONDS);
    unlockDoneRef.current = false;
    fadeAnim.setValue(1);
    slideAnim.setValue(0);
  }, [visible, fadeAnim, slideAnim]);

  useEffect(() => {
    animateStepChange();
  }, [step, animateStepChange]);

  useEffect(() => {
    if (!visible) {
      unlockDoneRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || step !== 3) return undefined;
    const id = setInterval(() => {
      setRemainingSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [visible, step]);

  useEffect(() => {
    if (!visible || step !== 3 || remainingSeconds > 0 || unlockDoneRef.current) return;
    unlockDoneRef.current = true;
    onUnlockSuccess?.();
    onClose?.();
  }, [visible, step, remainingSeconds, onUnlockSuccess, onClose]);

  const goStep2 = () => setStep(2);
  const goStep3 = () => {
    setRemainingSeconds(STEP_WAIT_SECONDS);
    setStep(3);
  };

  const handleCancel = () => {
    onClose?.();
  };

  const selectedAmountDisplay = `TSh ${selectedPlan.amountFormatted}`;

  const isPhoneValid =
    !!phoneNumber && phoneNumber.length === 10 && phoneNumber.startsWith('0');

  const handleStep2Continue = () => {
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu');
      return;
    }
    goStep3();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
                        {PLANS.map((plan) => {
                          const selected = selectedPlan.id === plan.id;
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
                                <Text style={styles.planLabel}>{plan.label}</Text>
                                <Text style={styles.planPrice}>TSh {plan.amountFormatted}</Text>
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
                          <TextInput
                            style={[styles.input, styles.step2GapClear]}
                            placeholder="0712345678"
                            placeholderTextColor="#6B7280"
                            keyboardType="phone-pad"
                            maxLength={10}
                            value={phoneNumber}
                            onChangeText={setPhoneNumber}
                          />
                          <Text style={[styles.networksLabel, styles.step2GapClear]}>
                            Mitandao inayokubaliwa
                          </Text>
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
                            disabled={!isPhoneValid}
                            style={[
                              styles.cta,
                              styles.ctaDockBtn,
                              !isPhoneValid && styles.ctaDisabled,
                            ]}
                            onPress={handleStep2Continue}
                          >
                            <Text style={styles.ctaText}>LIPIA SASA</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {step === 3 && (
                      <View style={styles.step3Wrap}>
                        <ActivityIndicator size="large" color={ACCENT} style={styles.spinner} />
                        <Text style={styles.waitTitle}>Inasubiri uthibitisho wa malipo</Text>
                        <Text style={styles.waitPin}>
                          Weka PIN kuthibitisha malipo ya {selectedAmountDisplay}
                        </Text>
                        <Text style={styles.countdown}>{formatCountdown(remainingSeconds)}</Text>
                      </View>
                    )}
                  </Animated.View>
                </ScrollView>
                <View style={styles.ctaDock} pointerEvents="box-none">
                  {step === 1 ? (
                    <Pressable style={[styles.cta, styles.ctaDockBtn]} onPress={goStep2}>
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
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 18,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: '#1F2229',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planRowSelected: {
    borderColor: ACCENT,
    backgroundColor: '#252A33',
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
    fontWeight: '600',
  },
  planPrice: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  cta: {
    backgroundColor: ACCENT,
    width: '100%',
    height: 58,
    paddingHorizontal: 18,
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
    backgroundColor: '#1F2229',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: '#FFFFFF',
    marginBottom: 16,
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
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  waitPin: {
    color: '#D1D5DB',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  countdown: {
    color: ACCENT,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 24,
  },
  cancelBtn: {
    width: '100%',
    height: 58,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  cancelBtnText: {
    color: '#E5E7EB',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});
