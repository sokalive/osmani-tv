import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import EventSource from 'react-native-sse';
import {
  getCheckoutPaymentProviders,
  getPaymentProviders,
  getPaymentStatus,
  resolveCheckoutStartPayment,
} from '../api/payment';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import {
  formatCheckoutPaymentError,
  isPaymentCreateOrderTimeout,
  PhoneSubscriptionConflictError,
} from '../lib/paymentCheckoutErrors';
import { CHECKOUT_GATEWAY_META } from '../lib/checkoutPaymentProviders';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { verifySubscription } from '../api/subscription';
import { formatUserFacingApiError } from '../lib/catalogConnectivity';
import {
  isSubscriptionActive,
  latestExpiryIso,
  runPaymentActivationTick,
} from '../lib/paymentActivation';
import {
  getCachedPaymentPlansSync,
  normalizePaymentPlansList,
  PAYMENT_PLANS_FIRST_SPINNER_MAX_MS,
  pickDefaultPaymentPlan,
  refreshPaymentPlansCache,
  seedPaymentPlansCacheFromVerify,
} from '../lib/paymentPlansCache';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { reportPaymentTelemetry } from '../api/userCenterSync';
import { cacheSecurityPhone } from '../lib/security/securityPhone';
import EmergencyModal from './EmergencyModal';
import PaymentWaitingStep from './PaymentWaitingStep';
import PaymentSuccessStep from './PaymentSuccessStep';
import { buildPaymentSuccessDetails } from '../lib/paymentSuccessDisplay';
import { mergeCheckoutPlanIntoSubscription } from '../lib/accountSubscriptionDisplay';

const ACCENT = '#FACC15';
const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];
const ACCENT_GLOW = 'rgba(250, 204, 21, 0.55)';
const SHEET_BG = '#0F1115';
const CARD_BG = '#1E222B';
const CARD_BG_ACTIVE = '#2A2F3A';
const TEXT_MUTED = '#9CA3AF';

const NETWORK_COLORS = {
  Tigo: '#1F8FFF',
  'M-Pesa': '#22C55E',
  Airtel: '#EF4444',
  HaloPesa: '#F59E0B',
};

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MODAL_MAX_HEIGHT = Math.round(WINDOW_HEIGHT * 0.85);

const POLL_MS = 1500;
/** Waiting window when create-order HTTP timed out but USSD/PIN may still be active. */
const CREATE_ORDER_ORPHAN_WAIT_SEC = 300;

/**
 * Local fallback used only when GET /api/payment-providers fails or
 * returns an empty list. Live admin-managed providers + logos populate
 * the grid at runtime via `getPaymentProviders()`.
 */
const FALLBACK_NETWORKS = [
  { id: 'tigo', name: 'Tigo', logoUrl: null, active: true },
  { id: 'mpesa', name: 'M-Pesa', logoUrl: null, active: true },
  { id: 'airtel', name: 'Airtel', logoUrl: null, active: true },
  { id: 'halopesa', name: 'HaloPesa', logoUrl: null, active: true },
];

function formatPriceTz(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  try {
    return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(num);
  } catch {
    return String(Math.round(num));
  }
}

function formatPlanDuration(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value === '-' || value === '—') return '(—)';
  const match = value.match(/\d+/);
  if (match) return `(${match[0]} siku)`;
  return `(${value.replace(/^\(|\)$/g, '')})`;
}

/**
 * @param {{ visible: boolean; onClose: () => void; onUnlockSuccess?: () => void }} props
 */
export default function PremiumModal({ visible, onClose, onUnlockSuccess, channelName = 'Chaneli Uliyofungua' }) {
  const insets = useSafeAreaInsets();
  const { refreshSubscription, unlockChannels, availablePlans } = useOsmaniApp();
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState(() => getCachedPaymentPlansSync() ?? []);
  const [plansLoading, setPlansLoading] = useState(() => !getCachedPaymentPlansSync()?.length);
  const [plansError, setPlansError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [orderId, setOrderId] = useState(null);
  const [waitingDeviceId, setWaitingDeviceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [successDetails, setSuccessDetails] = useState(null);
  const [providers, setProviders] = useState(FALLBACK_NETWORKS);
  const [logoErrors, setLogoErrors] = useState({});
  const [checkoutProvider, setCheckoutProvider] = useState('zenopay');
  const [checkoutTestMode, setCheckoutTestMode] = useState(false);
  const [phoneGuardVisible, setPhoneGuardVisible] = useState(false);
  const [phoneGuardTitle, setPhoneGuardTitle] = useState('Taarifa');
  const [phoneGuardMessage, setPhoneGuardMessage] = useState('');
  const [checkoutLogoUrl, setCheckoutLogoUrl] = useState(null);
  const [paymentProgressStep, setPaymentProgressStep] = useState(1);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const pollTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const sseRef = useRef(null);
  const doneRef = useRef(false);
  const payInFlightRef = useRef(false);
  const identityPrefetchRef = useRef(null);

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
    setPlansError('');
    setSelectedPlan(null);
    setPhoneNumber('');
    setRemainingSeconds(0);
    setOrderId(null);
    setWaitingDeviceId('');
    setSubmitting(false);
    setFailureReason('');
    setSuccessDetails(null);
    setPhoneGuardVisible(false);
    setPhoneGuardTitle('Taarifa');
    setPhoneGuardMessage('');
    setPaymentProgressStep(1);
    payInFlightRef.current = false;
    identityPrefetchRef.current = null;
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
    if (step !== 3) {
      ringRotate.setValue(0);
      return undefined;
    }
    ringRotate.setValue(0);
    const loop = Animated.loop(
      Animated.timing(ringRotate, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [step, ringRotate]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let spinnerCapTimer = null;

    const applyPlans = (list) => {
      if (!list?.length || cancelled) return;
      setPlans(list);
      setSelectedPlan((prev) => pickDefaultPaymentPlan(list, prev));
      setPlansLoading(false);
      setPlansError('');
    };

    const cached = getCachedPaymentPlansSync();
    if (cached?.length) {
      applyPlans(cached);
    } else if (Array.isArray(availablePlans) && availablePlans.length > 0) {
      const fromVerify = normalizePaymentPlansList(availablePlans);
      if (fromVerify.length) {
        applyPlans(fromVerify);
        void seedPaymentPlansCacheFromVerify(availablePlans);
      }
    }

    if (!getCachedPaymentPlansSync()?.length && !availablePlans?.length) {
      setPlansLoading(true);
      spinnerCapTimer = setTimeout(() => {
        if (!cancelled) setPlansLoading(false);
      }, PAYMENT_PLANS_FIRST_SPINNER_MAX_MS);
    } else {
      setPlansLoading(false);
    }

    void refreshPaymentPlansCache({ reason: 'modal-open' }).then((list) => {
      if (cancelled) return;
      if (spinnerCapTimer) clearTimeout(spinnerCapTimer);
      if (list?.length) applyPlans(list);
      setPlansLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      if (spinnerCapTimer) clearTimeout(spinnerCapTimer);
      setPlansLoading(false);
      if (!getCachedPaymentPlansSync()?.length) {
        setPlansError(formatUserFacingApiError(e));
      }
    });

    return () => {
      cancelled = true;
      if (spinnerCapTimer) clearTimeout(spinnerCapTimer);
    };
  }, [visible, availablePlans]);

  /** Sync active checkout gateway (zenopay | sonicpesa | auraxpay) from admin API. */
  const reloadCheckoutConfig = useCallback(async () => {
    try {
      const cfg = await getCheckoutPaymentProviders();
      setCheckoutProvider(cfg.payment_provider);
      setCheckoutTestMode(cfg.auraxpay_test === true);
      setCheckoutLogoUrl(cfg.logos?.auraxpay ?? null);
      console.log('[PremiumModal]', 'checkout_provider', cfg.payment_provider, {
        auraxpay: cfg.auraxpay,
        auraxpay_test: cfg.auraxpay_test,
      });
      return cfg;
    } catch (e) {
      console.log('[PremiumModal]', 'checkout_provider_load_failed', e?.message ?? e);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    void reloadCheckoutConfig();
    return undefined;
  }, [visible, reloadCheckoutConfig]);

  /** Refresh gateway routing when admin toggles Aurax/SonicPesa without closing modal. */
  useEffect(() => {
    if (!visible) return undefined;
    const events = [
      'aurax_settings_changed',
      'sonicpesa_settings_changed',
      'payment_providers_changed',
    ];
    const offs = events.map((ev) =>
      subscribeRealtimeEvent(ev, () => {
        void reloadCheckoutConfig();
      }),
    );
    return () => {
      offs.forEach((off) => off());
    };
  }, [visible, reloadCheckoutConfig]);

  /** Prefetch device identity on step 2 so Lipia begins checkout without extra await. */
  useEffect(() => {
    if (!visible || step !== 2) return undefined;
    let cancelled = false;
    void getDeviceIdentity().then((identity) => {
      if (!cancelled) identityPrefetchRef.current = identity;
    });
    return () => {
      cancelled = true;
    };
  }, [visible, step]);

  /** When modal opens, always sync subscription from server (do not trust stale context). */
  useEffect(() => {
    if (!visible) return undefined;
    void refreshSubscription();
  }, [visible, refreshSubscription]);

  /**
   * Fetch admin-managed payment providers when the modal opens.
   * On failure or empty list, the local FALLBACK_NETWORKS stays in place.
   */
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const list = await getPaymentProviders();
        if (cancelled) return;
        if (Array.isArray(list) && list.length > 0) {
          setProviders(list);
          setLogoErrors({});
        }
      } catch {
        // keep fallback providers; do not surface to user
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  /** Payment verified active — unlock, show success dialog (no navigation until FUNGUA CHANNEL). */
  const finalizePaymentSuccess = useCallback(
    async (verified, fetchExpires = null) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setPaymentProgressStep(3);
      clearTimers();
      closeSse();

      const mergedExpires = latestExpiryIso(verified?.expiresAt, fetchExpires);
      const forUnlock = mergeCheckoutPlanIntoSubscription(
        {
          ...verified,
          active: true,
          isActive: true,
          expiresAt: mergedExpires ?? verified?.expiresAt ?? null,
        },
        selectedPlan,
      );

      unlockChannels(forUnlock);
      if (Array.isArray(forUnlock?.plans) && forUnlock.plans.length > 0) {
        void seedPaymentPlansCacheFromVerify(forUnlock.plans);
      }

      setSuccessDetails(
        buildPaymentSuccessDetails(forUnlock, {
          name: selectedPlan?.name ?? null,
          price: selectedPlan?.price ?? null,
        }),
      );

      void reportPaymentTelemetry('success', {
        order_id: orderId ?? null,
        plan_id: selectedPlan?.id ?? null,
        provider: checkoutProvider,
      });
      console.log('[PremiumModal]', 'payment_success_dialog', {
        orderId: orderId ?? null,
        planName: forUnlock?.planName ?? selectedPlan?.name ?? null,
        expiresAt: forUnlock?.expiresAt ?? null,
      });
      setStep(4);

      void refreshSubscription().catch(() => {});
    },
    [
      clearTimers,
      closeSse,
      unlockChannels,
      refreshSubscription,
      orderId,
      selectedPlan,
      checkoutProvider,
    ],
  );

  const handleOpenChannel = useCallback(() => {
    try {
      onUnlockSuccess?.();
    } catch (e) {
      console.log('[PremiumModal]', 'onUnlockSuccess_error', e?.message ?? e);
    }
    onClose?.();
  }, [onUnlockSuccess, onClose]);

  /**
   * MFALME-style single activation tick per poll/SSE event (no blocking multi-minute loops).
   * Keeps polling/SSE alive until finalizePaymentSuccess.
   */
  const schedulePostPaymentActivationPolls = useCallback(
    async ({ paymentConfirmed = false, source = 'poll' } = {}) => {
      if (doneRef.current) return false;
      if (paymentConfirmed) setPaymentProgressStep(2);

      try {
        const identity = await getDeviceIdentity();
        const { deviceId, deviceFingerprint } = identity;
        const result = await runPaymentActivationTick({
          deviceId,
          deviceFingerprint,
          identity,
          refreshSubscription,
        });

        if (result.active && result.subscription) {
          await finalizePaymentSuccess(result.subscription, result.fetchExpires);
          void refreshSubscription().catch(() => {});
          console.log('[PremiumModal]', 'payment_activation_success', { source });
          return true;
        }

        console.log('[PAYMENT_SUCCESS_VERIFY]', 'activation_pending', {
          source,
          paymentConfirmed,
          active: result.subscription?.active,
          isActive: result.subscription?.isActive,
        });
        return false;
      } catch (e) {
        console.log('[PAYMENT_SUCCESS_VERIFY]', 'activation_error', e?.message ?? e);
        return false;
      }
    },
    [refreshSubscription, finalizePaymentSuccess],
  );

  const handleFailed = useCallback(
    (reason) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      setFailureReason(
        formatCheckoutPaymentError(reason || 'Malipo hayajafanikiwa', {
          provider: checkoutProvider,
        }) || 'Malipo hayajafanikiwa',
      );
      if (reason) {
        console.log(
          '[PremiumModal]',
          'payment_poll_failed',
          JSON.stringify({ provider: checkoutProvider, backendReason: reason }),
        );
      }
      void reportPaymentTelemetry(/timeout/i.test(String(reason ?? '')) ? 'timeout' : 'failure', {
        order_id: orderId ?? null,
        provider: checkoutProvider,
        reason: String(reason ?? ''),
      });
      setStep(5);
    },
    [clearTimers, checkoutProvider],
  );

  const pollOnce = useCallback(
    async (oid) => {
      if (doneRef.current) return;
      try {
        const { status, reason } = await getPaymentStatus(oid);
        if (doneRef.current) return;
        if (status === 'FAILED') {
          handleFailed(reason);
          return;
        }

        let peek = null;
        try {
          const { deviceId, deviceFingerprint } = await getDeviceIdentity();
          peek = await verifySubscription(deviceId, deviceFingerprint);
        } catch {
          peek = null;
        }
        if (doneRef.current) return;
        if (peek && isSubscriptionActive(peek)) {
          await schedulePostPaymentActivationPolls({ paymentConfirmed: true, source: 'poll-verify' });
          return;
        }

        if (status === 'SUCCESS') {
          await schedulePostPaymentActivationPolls({ paymentConfirmed: true, source: 'poll-success' });
        }
      } catch {
        // transient network — keep polling
      }
    },
    [schedulePostPaymentActivationPolls, handleFailed],
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

  /**
   * create-order HTTP may time out after USSD/PIN was already triggered.
   * Poll subscription activation without order_id until success or countdown ends.
   */
  useEffect(() => {
    if (!visible || step !== 3 || orderId || !waitingDeviceId || doneRef.current) return undefined;

    const recover = () => {
      void schedulePostPaymentActivationPolls({
        paymentConfirmed: true,
        source: 'create-order-timeout-recovery',
      });
    };
    recover();
    const id = setInterval(recover, POLL_MS);
    return () => clearInterval(id);
  }, [visible, step, orderId, waitingDeviceId, schedulePostPaymentActivationPolls]);

  useEffect(() => {
    if (!visible || step !== 3 || !waitingDeviceId || doneRef.current) return undefined;
    closeSse();
    const url = `${resolveApiBaseUrl()}/api/subscription-stream?device_id=${encodeURIComponent(waitingDeviceId)}`;
    const stream = new EventSource(url, { pollingInterval: 0 });
    sseRef.current = stream;

    const onMessage = (event) => {
      if (doneRef.current) return;
      void (async () => {
        try {
          const payload = JSON.parse(event?.data ?? '{}');
          const payloadActive = payload?.isActive === true || payload?.active === true;
          if (!payloadActive) return;
          const { deviceId, deviceFingerprint } = await getDeviceIdentity();
          const verified = await verifySubscription(deviceId, deviceFingerprint);
          if (doneRef.current) return;
          if (verified && isSubscriptionActive(verified)) {
            console.log('[PremiumModal]', 'subscription_stream_active');
            await schedulePostPaymentActivationPolls({
              paymentConfirmed: true,
              source: 'subscription-stream',
            });
          }
        } catch {
          // ignore malformed stream payloads / transient verify errors
        }
      })();
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
  }, [visible, step, waitingDeviceId, closeSse, schedulePostPaymentActivationPolls]);

  /** Admin / gateway payment_success SSE — activate immediately without waiting for next poll. */
  useEffect(() => {
    if (!visible || step !== 3 || doneRef.current) return undefined;
    const events = [
      'payment_success',
      'payment_completed',
      'subscription_activated',
      'subscription_granted',
      'subscription_changed',
      'subscription_updated',
    ];
    const offs = events.map((ev) =>
      subscribeRealtimeEvent(ev, () => {
        if (doneRef.current) return;
        console.log('[PremiumModal]', 'payment_sse', ev);
        void schedulePostPaymentActivationPolls({ paymentConfirmed: true, source: `sse:${ev}` });
      }),
    );
    return () => {
      offs.forEach((off) => off());
    };
  }, [visible, step, schedulePostPaymentActivationPolls]);

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

  const ringSpin = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleStep2Pay = async () => {
    console.log('PAYMENT TRIGGERED');
    if (submitting || payInFlightRef.current) return;
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu');
      return;
    }
    if (!selectedPlan?.id) {
      Alert.alert('', 'Chagua mpango');
      return;
    }
    payInFlightRef.current = true;
    setSubmitting(true);
    const activeProvider = checkoutProvider;
    const normalizedPhone = phoneNumber.replace(/\s/g, '');
    let identity = identityPrefetchRef.current;
    try {
      identity = identity ?? (await getDeviceIdentity());
      identityPrefetchRef.current = identity;
      const { deviceId, deviceFingerprint } = identity;
      const payPayload = {
        phone: normalizedPhone,
        plan_id: selectedPlan.id,
        amount: selectedPlan.price,
        device_id: deviceId,
        device_fingerprint: deviceFingerprint,
      };
      void cacheSecurityPhone(payPayload.phone);
      const startPayment = resolveCheckoutStartPayment(activeProvider);
      console.log('[PremiumModal]', 'payment_start', { provider: activeProvider, planId: selectedPlan.id });
      const { order_id: oid, expiresInSeconds } = await startPayment(payPayload);
      doneRef.current = false;
      setWaitingDeviceId(deviceId);
      setOrderId(oid);
      const wait =
        typeof expiresInSeconds === 'number' && expiresInSeconds > 0
          ? Math.floor(expiresInSeconds)
          : 0;
      setRemainingSeconds(wait);
      setPaymentProgressStep(1);
      setStep(3);
      void reportPaymentTelemetry('started', {
        order_id: oid,
        plan_id: selectedPlan.id,
        provider: activeProvider,
        amount: selectedPlan.price,
      });
    } catch (e) {
      if (e instanceof PhoneSubscriptionConflictError || e?.name === 'PhoneSubscriptionConflictError') {
        const userMsg = e.userMessage ?? e.message ?? 'Namba hii tayari ina kifurushi hai.';
        setPhoneGuardTitle(e.title ?? 'Taarifa');
        setPhoneGuardMessage(userMsg);
        setPhoneGuardVisible(true);
        console.log(
          '[PremiumModal]',
          'phone_subscription_guard',
          JSON.stringify({
            code: e.code,
            provider: e.provider ?? activeProvider,
            httpStatus: e.httpStatus,
            path: e.path,
            title: e.title ?? null,
            displaySource: e.conflict?.displaySource ?? null,
          }),
        );
        void reportPaymentTelemetry('phone_subscription_conflict', {
          plan_id: selectedPlan?.id ?? null,
          provider: e.provider ?? activeProvider,
          code: e.code ?? null,
          reason: e.backendReason ?? null,
        });
        return;
      }
      if (isPaymentCreateOrderTimeout(e) && identity?.deviceId) {
        console.log(
          '[PremiumModal]',
          'create_order_timeout_recovery',
          JSON.stringify({ provider: activeProvider, deviceId: identity.deviceId }),
        );
        doneRef.current = false;
        setWaitingDeviceId(identity.deviceId);
        setOrderId(null);
        setRemainingSeconds(CREATE_ORDER_ORPHAN_WAIT_SEC);
        setPaymentProgressStep(1);
        setStep(3);
        void reportPaymentTelemetry('create_order_timeout_recovery', {
          plan_id: selectedPlan?.id ?? null,
          provider: activeProvider,
        });
        return;
      }
      const userMsg = e?.userMessage ?? e?.message ?? 'Imeshindwa kuanzisha malipo';
      if (e?.backendReason) {
        console.log(
          '[PremiumModal]',
          'payment_start_failed',
          JSON.stringify({
            provider: activeProvider,
            backendReason: e.backendReason,
            httpStatus: e.httpStatus,
            path: e.path,
            userMsg,
          }),
        );
      }
      let alertMsg = userMsg;
      if (checkoutTestMode && e?.backendReason) {
        alertMsg = `${userMsg}\n\n[Jaribio] ${e.backendReason}`;
      }
      void reportPaymentTelemetry('failure', {
        plan_id: selectedPlan?.id ?? null,
        provider: activeProvider,
        reason: e?.backendReason ?? userMsg,
      });
      Alert.alert('Malipo', alertMsg);
    } finally {
      setSubmitting(false);
      payInFlightRef.current = false;
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

  const compactResultStep = step === 5;
  const successSheetHeight = Math.min(620, Math.round(WINDOW_HEIGHT * 0.72));
  const compactSheetHeight = Math.min(460, Math.round(WINDOW_HEIGHT * 0.56));

  return (
    <>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        <View style={styles.centeredWrap} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              step === 4
                ? { height: successSheetHeight, maxHeight: successSheetHeight }
                : compactResultStep
                  ? { height: compactSheetHeight, maxHeight: compactSheetHeight }
                  : { height: MODAL_MAX_HEIGHT, maxHeight: MODAL_MAX_HEIGHT },
            ]}
          >
            <SafeAreaView
              edges={['top', 'bottom']}
              style={step === 2 ? [styles.sheetSafe, styles.sheetSafeCompactBottom] : styles.sheetSafe}
            >
              <View style={styles.sheetBody}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  scrollEnabled={step !== 3 && step !== 4}
                  style={styles.modalScroll}
                  contentContainerStyle={
                    step === 2
                      ? [styles.modalScrollContentStep2Centered]
                      : step === 3
                        ? styles.modalScrollContentStep3
                        : compactResultStep
                          ? styles.modalScrollContentCompactResult
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
                        <View style={styles.crownHaloWrap}>
                          <View style={styles.crownGlow} />
                          <View style={styles.crownCircle}>
                            <Ionicons name="diamond" size={26} color="#0F172A" />
                          </View>
                        </View>
                        <Text style={styles.titleCentered}>Karibu Osman TV</Text>
                        <Text style={styles.subtitleCentered} numberOfLines={2}>
                          {channelName} ni channel ya premium
                        </Text>
                        {plansLoading ? (
                          <ActivityIndicator size="large" color={ACCENT} style={styles.plansSpinner} />
                        ) : null}
                        {plansError ? <Text style={styles.errorText}>{plansError}</Text> : null}
                        {!plansLoading && !plansError && plans.length === 0 ? (
                          <Text style={styles.mutedCenter}>Hakuna mipango inayopatikana kwa sasa.</Text>
                        ) : null}
                        <View style={styles.plansList}>
                          {plans.map((plan) => {
                            const selected = selectedPlan?.id === plan.id;
                            return (
                              <Pressable
                                key={plan.id}
                                onPress={() => setSelectedPlan(plan)}
                                style={[styles.planRow, selected && styles.planRowSelected]}
                              >
                                {selected ? (
                                  <LinearGradient
                                    colors={['rgba(250,204,21,0.14)', 'rgba(250,204,21,0.02)']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={StyleSheet.absoluteFill}
                                    pointerEvents="none"
                                  />
                                ) : null}
                                <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
                                  {selected ? <View style={styles.radioInner} /> : null}
                                </View>
                                <View style={styles.planTextCol}>
                                  <Text style={styles.planLabel}>{plan.name}</Text>
                                  <Text style={styles.planMeta}>{formatPlanDuration(plan.duration)}</Text>
                                </View>
                                <Text style={styles.planPriceRight}>
                                  TSh {formatPriceTz(plan.price)}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.benefitsList}>
                          {[
                            'Ukilipia Una Tazama Channel zote',
                            'Channel Zote Ni HD & 4K Streaming',
                            'Hakuna Kuganda kwa Channel',
                            'Channel Zipo Live Muda Wote',
                          ].map((line) => (
                            <View key={line} style={styles.benefitRow}>
                              <Ionicons name="checkmark-circle" size={18} color={ACCENT} />
                              <Text style={styles.benefitText}>{line}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {step === 2 && (
                      <View style={styles.step2OuterPadding}>
                        <View style={styles.step2TopSection}>
                          <View style={styles.titleRow}>
                            <View style={styles.titleIconCircle}>
                              <Ionicons name="phone-portrait" size={14} color="#0F172A" />
                            </View>
                            <Text style={[styles.title, styles.step2GapClear]}>Weka Namba ya Simu</Text>
                          </View>
                          <Text style={styles.subtitleNetworks}>Tigo, M-Pesa, Airtel, HaloPesa</Text>
                          <View style={[styles.inputWrap, styles.step2GapClear]}>
                            <Ionicons
                              name="call"
                              size={18}
                              color={ACCENT}
                              style={styles.inputIcon}
                            />
                            <TextInput
                              style={styles.inputField}
                              placeholder="0712345678"
                              placeholderTextColor="#6B7280"
                              keyboardType="phone-pad"
                              maxLength={10}
                              value={phoneNumber}
                              onChangeText={setPhoneNumber}
                            />
                          </View>
                          <Text style={[styles.networksLabel, styles.step2GapClear]}>Mitandao inayokubaliwa</Text>
                          {checkoutProvider === 'auraxpay' ? (
                            <View style={[styles.checkoutBadge, styles.step2GapClear]}>
                              {checkoutLogoUrl ? (
                                <Image
                                  source={{ uri: checkoutLogoUrl }}
                                  style={styles.checkoutBadgeLogo}
                                  resizeMode="contain"
                                />
                              ) : (
                                <View
                                  style={[
                                    styles.checkoutBadgeIcon,
                                    { backgroundColor: CHECKOUT_GATEWAY_META.auraxpay.accent },
                                  ]}
                                >
                                  <Text style={styles.checkoutBadgeIconText}>
                                    {CHECKOUT_GATEWAY_META.auraxpay.initial}
                                  </Text>
                                </View>
                              )}
                              <Text style={styles.checkoutBadgeText}>
                                {CHECKOUT_GATEWAY_META.auraxpay.name}
                              </Text>
                            </View>
                          ) : null}
                          <View style={[styles.networksGrid, styles.step2GapClear]}>
                            {providers.map((n) => {
                              const tint = NETWORK_COLORS[n.name] || ACCENT;
                              const initial = (n.name || '').slice(0, 1).toUpperCase();
                              const failed = !!logoErrors[n.id];
                              const showLogo = !!n.logoUrl && !failed;
                              return (
                                <View key={n.id} style={styles.networkCardOuter}>
                                  <View
                                    style={[
                                      styles.networkCard,
                                      !showLogo && { backgroundColor: tint, borderColor: tint },
                                    ]}
                                  >
                                    {showLogo ? (
                                      <Image
                                        source={{ uri: n.logoUrl }}
                                        style={styles.networkLogoFill}
                                        resizeMode="cover"
                                        onError={() =>
                                          setLogoErrors((prev) =>
                                            prev[n.id] ? prev : { ...prev, [n.id]: true },
                                          )
                                        }
                                      />
                                    ) : (
                                      <Text style={styles.networkInitialFillText}>{initial}</Text>
                                    )}
                                  </View>
                                  <Text style={styles.networkCardText} numberOfLines={1}>
                                    {n.name}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                        <View style={styles.step2FlexSpacer} />
                        <View style={styles.step2BottomSection}>
                          <Pressable
                            disabled={!isPhoneValid || submitting}
                            style={[
                              styles.ctaWrap,
                              styles.ctaDockBtn,
                              (!isPhoneValid || submitting) && styles.ctaDisabled,
                            ]}
                            onPress={handleStep2Pay}
                          >
                            <LinearGradient
                              colors={ACCENT_GRADIENT}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={styles.ctaGradient}
                            >
                              {submitting ? (
                                <ActivityIndicator color="#111827" />
                              ) : (
                                <Text style={styles.ctaText}>Lipia — {selectedAmountDisplay}</Text>
                              )}
                            </LinearGradient>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {step === 3 && (
                      <PaymentWaitingStep
                        selectedAmountDisplay={selectedAmountDisplay}
                        orderId={orderId}
                        remainingSeconds={remainingSeconds}
                        checkoutProvider={checkoutProvider}
                        checkoutLogoUrl={checkoutLogoUrl}
                        paymentProgressStep={paymentProgressStep}
                        ringSpin={ringSpin}
                      />
                    )}

                    {step === 4 && (
                      <PaymentSuccessStep
                        details={successDetails}
                        onOpenChannel={handleOpenChannel}
                      />
                    )}

                    {step === 5 && (
                      <View style={styles.resultWrap}>
                        <View style={styles.failIconHalo}>
                          <View style={styles.failIconCircle}>
                            <Ionicons name="alert" size={28} color="#FFFFFF" />
                          </View>
                        </View>
                        <Text style={styles.failTitle}>Malipo hayajakamilika</Text>
                        <Text style={styles.failBody}>{failureReason}</Text>
                        <Pressable style={[styles.ctaWrap, styles.resultCta]} onPress={handleRetry}>
                          <LinearGradient
                            colors={ACCENT_GRADIENT}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.ctaGradient}
                          >
                            <Text style={styles.ctaText}>JARIBU TENA</Text>
                          </LinearGradient>
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
                      style={[styles.ctaWrap, styles.ctaDockBtn, (!selectedPlan || plansLoading) && styles.ctaDisabled]}
                      disabled={!selectedPlan || plansLoading}
                      onPress={goStep2}
                    >
                      <LinearGradient
                        colors={ACCENT_GRADIENT}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.ctaGradient}
                      >
                        <Text style={styles.ctaText}>Lipia — {selectedAmountDisplay}</Text>
                      </LinearGradient>
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
    <EmergencyModal
      visible={phoneGuardVisible}
      title={phoneGuardTitle}
      message={phoneGuardMessage}
      iconName="warning"
      primaryLabel="Sawa"
      onSawa={() => setPhoneGuardVisible(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
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
    backgroundColor: SHEET_BG,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.18)',
    alignSelf: 'center',
    elevation: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
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
  modalScrollContentStep3: {
    paddingBottom: 88,
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  modalScrollContentCompactResult: {
    paddingBottom: 24,
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
    padding: 12,
    width: '100%',
    minHeight: 0,
    justifyContent: 'center',
  },
  step2TopSection: {
    gap: 12,
  },
  step2FlexSpacer: {
    height: 16,
  },
  step2BottomSection: {
    width: '100%',
    marginBottom: 4,
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
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(250,204,21,0.30)',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  titleIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  subtitle: {
    color: TEXT_MUTED,
    fontSize: 13,
    marginBottom: 18,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  crownHaloWrap: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    marginTop: 2,
  },
  crownGlow: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(250,204,21,0.16)',
  },
  crownCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 16,
    elevation: 12,
  },
  titleCentered: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  subtitleCentered: {
    color: TEXT_MUTED,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: 0.2,
    paddingHorizontal: 8,
    lineHeight: 19,
  },
  plansList: {
    width: '100%',
  },
  benefitsList: {
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
    gap: 10,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitText: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  subtitleNetworks: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: -2,
    marginBottom: 4,
    letterSpacing: 0.2,
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
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: '#161A22',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    position: 'relative',
  },
  planRowSelected: {
    borderColor: ACCENT,
    backgroundColor: '#1B1F28',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.40,
    shadowRadius: 14,
    elevation: 8,
  },
  planBadge: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4B5563',
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(250,204,21,0.10)',
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
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  planMeta: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    letterSpacing: 0.2,
  },
  planPrice: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: 0.3,
  },
  planPriceRight: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginLeft: 12,
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
  },
  ctaWrap: {
    width: '100%',
    minHeight: 58,
    borderRadius: 18,
    alignSelf: 'stretch',
    marginTop: 20,
    marginBottom: 20,
    overflow: 'hidden',
    elevation: 14,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
  },
  ctaGradient: {
    flex: 1,
    minHeight: 58,
    paddingVertical: 17,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  ctaText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 17,
    color: '#FFFFFF',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A323F',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1F28',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.18)',
  },
  inputIcon: {
    marginRight: 10,
  },
  inputField: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  networksLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    marginBottom: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  checkoutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(8,145,178,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(8,145,178,0.35)',
    marginBottom: 10,
  },
  checkoutBadgeLogo: {
    width: 22,
    height: 22,
    borderRadius: 4,
  },
  checkoutBadgeIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutBadgeIconText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  checkoutBadgeText: {
    color: '#E0F2FE',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  networksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  networkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#1F242E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 6,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  networkChipText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  networksGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  networkCardOuter: {
    width: '48%',
    marginBottom: 12,
  },
  networkCard: {
    width: '100%',
    height: 84,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#1F242E',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
  },
  networkLogoFill: {
    width: '100%',
    height: '100%',
  },
  networkInitialFillText: {
    color: '#0F172A',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  networkCardText: {
    marginTop: 8,
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  step3Wrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  spinner: {
    marginBottom: 20,
  },
  loaderHaloWrap: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 22,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 18,
    elevation: 10,
  },
  loaderRing: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: 'rgba(250,204,21,0.18)',
    borderTopColor: ACCENT,
  },
  loaderInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#161B23',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.20)',
  },
  waitTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  waitPin: {
    color: '#D1D5DB',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 14,
  },
  amountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(250,204,21,0.10)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.30)',
    marginBottom: 14,
  },
  amountPillText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  countdown: {
    color: ACCENT,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 16,
    textShadowColor: ACCENT_GLOW,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  orderHint: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
    paddingHorizontal: 12,
  },
  orderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1F28',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    maxWidth: '92%',
  },
  orderPillLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  orderPillValue: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  resultWrap: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  successIconHalo: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 10,
  },
  successIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(74,222,128,0.45)',
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
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  successBody: {
    color: '#D1D5DB',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  successFootnote: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 6,
  },
  successHighlight: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  failIconHalo: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 10,
  },
  failIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(239,68,68,0.45)',
  },
  failTitle: {
    color: '#F87171',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 0.3,
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
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
  },
  resultCta: {
    marginTop: 0,
    marginBottom: 8,
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
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  cancelBtnText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});

