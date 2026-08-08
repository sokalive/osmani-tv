import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
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
  resolveOrderPaymentStatus,
  resolveCheckoutStartPayment,
} from '../api/payment';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import {
  formatCheckoutPaymentError,
  isPaymentCreateOrderTimeout,
  PhoneSubscriptionConflictError,
  DeviceSubscriptionConflictError,
} from '../lib/paymentCheckoutErrors';
import {
  readCachedCheckoutProvider,
  writeCachedCheckoutProvider,
} from '../lib/checkoutProviderCache';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { formatUserFacingApiError } from '../lib/catalogConnectivity';
import {
  isPaymentEntitlementConfirmed,
  isSubscriptionActive,
  latestExpiryIso,
  probeSubscriptionActivation,
  runPaymentActivationTick,
  subscriptionHintFromPaymentStatusRaw,
} from '../lib/paymentActivation';
import {
  parseInstantSubscriptionFromSse,
  pickSubscriptionSseDeviceId,
  sseGrantTargetsThisDevice,
} from '../lib/subscriptionSseInstant';
import { registerDeviceIntelligence } from '../api/usersIntelligence';
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
import {
  APP_WAITING_STATE,
  computePollIntervalMs,
  isTerminalWaitingState,
  mapWaitingStateToProgressStep,
  PaymentReconcileGuard,
} from '../lib/paymentWaitingState';
import {
  ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE,
  ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_TITLE,
  classifyPaymentEntrySubscription,
  PAYMENT_ENTRY_VERIFY_ERROR_MESSAGE,
  PAYMENT_ENTRY_VERIFY_ERROR_TITLE,
} from '../lib/paymentEntryGuard';

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
/** Aggressive activation window after provider confirms (handoff: first 2 min). */
const ACTIVATION_AGGRESSIVE_MS = 120_000;
/** Default STK wait window once a real order_id exists. */
const CREATE_ORDER_WAIT_SEC = 180;
/** Hard cap: Lipia spinner must never exceed this even if create-order hangs unexpectedly. */
const LIPIA_SUBMITTING_WATCHDOG_MS = 50_000;
const CHECKOUT_PROVIDER_UNAVAILABLE_TITLE = 'Njia ya Malipo Haipatikani';
const CHECKOUT_PROVIDER_UNAVAILABLE_MESSAGE =
  'Imeshindwa kupata njia ya malipo kutoka seva. Hakuna njia mbadala — jaribu tena.';
const CREATE_ORDER_INIT_FAILED_MESSAGE =
  'Imeshindwa kuanzisha malipo. Hakuna ombi lililothibitishwa — jaribu tena.';
const CREATE_ORDER_TIMEOUT_MESSAGE =
  'Muda wa kuanzisha malipo umeisha. Hakuna STK iliyothibitishwa — jaribu tena.';

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

function pickPaymentSseOrderId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const nested =
    payload.payload && typeof payload.payload === 'object'
      ? payload.payload
      : payload.data && typeof payload.data === 'object'
        ? payload.data
        : null;
  const candidates = [payload, nested].filter(Boolean);
  for (const inner of candidates) {
    const raw =
      inner.order_id ??
      inner.orderId ??
      inner.payment?.order_id ??
      inner.payment?.orderId ??
      inner.transaction?.order_id ??
      inner.transaction?.orderId ??
      null;
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  return '';
}

/**
 * @param {{ visible: boolean; onClose: () => void; onUnlockSuccess?: () => void }} props
 */
export default function PremiumModal({ visible, onClose, onUnlockSuccess, channelName = 'Chaneli Uliyofungua' }) {
  const insets = useSafeAreaInsets();
  const { refreshSubscription, unlockChannels, availablePlans, isSubscribed } = useOsmaniApp();
  /** Start allowed when context already knows inactive — never flash the verify-wait UI. */
  const [paymentEntryGate, setPaymentEntryGate] = useState(() =>
    isSubscribed === true ? 'checking' : 'allowed',
  );
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
  /** null until backend (or safe verified cache) resolves — never invent zenopay. */
  const [checkoutProvider, setCheckoutProvider] = useState(null);
  /** loading | ready | error */
  const [checkoutProviderStatus, setCheckoutProviderStatus] = useState('loading');
  const [checkoutTestMode, setCheckoutTestMode] = useState(false);
  const [phoneGuardVisible, setPhoneGuardVisible] = useState(false);
  const [phoneGuardTitle, setPhoneGuardTitle] = useState('Taarifa');
  const [phoneGuardMessage, setPhoneGuardMessage] = useState('');
  const [closeAfterGuardDialog, setCloseAfterGuardDialog] = useState(false);
  const [paymentProgressStep, setPaymentProgressStep] = useState(1);
  const [appWaitingState, setAppWaitingState] = useState(APP_WAITING_STATE.PAYMENT_PENDING);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const pollTimerRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const sseRef = useRef(null);
  const doneRef = useRef(false);
  const payInFlightRef = useRef(false);
  const lipiaWatchdogRef = useRef(null);
  const identityPrefetchRef = useRef(null);
  const reconcileGuardRef = useRef(new PaymentReconcileGuard());
  const pollStartedAtRef = useRef(0);
  /** Wall-clock when payment SUCCESS / entitlement first observed — for true confirm→unlock latency. */
  const paymentConfirmedAtRef = useRef(0);
  const checkoutProviderRef = useRef(null);

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
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
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

  const showPaymentEntryDialog = useCallback((kind) => {
    const active = kind === 'active';
    setPaymentEntryGate(active ? 'blocked' : 'unavailable');
    setPhoneGuardTitle(
      active
        ? ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_TITLE
        : PAYMENT_ENTRY_VERIFY_ERROR_TITLE,
    );
    setPhoneGuardMessage(
      active
        ? ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE
        : PAYMENT_ENTRY_VERIFY_ERROR_MESSAGE,
    );
    setCloseAfterGuardDialog(true);
    setPhoneGuardVisible(true);
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
    setCloseAfterGuardDialog(false);
    // Instant plans for inactive users. Active users hard-block without verify-wait UI.
    setPaymentEntryGate(isSubscribed === true ? 'blocked' : 'allowed');
    setPaymentProgressStep(1);
    setAppWaitingState(APP_WAITING_STATE.PAYMENT_PENDING);
    reconcileGuardRef.current.reset();
    pollStartedAtRef.current = 0;
    paymentConfirmedAtRef.current = 0;
    payInFlightRef.current = false;
    identityPrefetchRef.current = null;
    if (lipiaWatchdogRef.current) {
      clearTimeout(lipiaWatchdogRef.current);
      lipiaWatchdogRef.current = null;
    }
    fadeAnim.setValue(1);
    slideAnim.setValue(0);
  }, [visible, clearTimers, fadeAnim, slideAnim]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;

    // Hard block from live context — never open plans while THIS device is subscribed.
    if (isSubscribed === true) {
      console.log('[PremiumModal]', 'payment_entry_gate', {
        classification: 'active',
        resolveSource: 'context:isSubscribed',
      });
      showPaymentEntryDialog('active');
      return undefined;
    }

    // Inactive / unknown context: show package selection immediately.
    // Verify runs invisibly; only a definitive THIS-device active response blocks.
    setPaymentEntryGate('allowed');
    void refreshSubscription('payment-entry-gate')
      .then((result) => {
        if (cancelled) return;
        if (isSubscribed === true) {
          showPaymentEntryDialog('active');
          return;
        }
        const classification = classifyPaymentEntrySubscription(result);
        console.log('[PremiumModal]', 'payment_entry_gate', {
          classification,
          resolveSource: result?.resolveSource ?? null,
          silent: true,
        });
        if (classification === 'active') {
          showPaymentEntryDialog('active');
        }
        // inactive / unknown: keep plans visible — never flash verify-wait UI.
      })
      .catch((error) => {
        if (cancelled) return;
        console.log('[PremiumModal]', 'payment_entry_gate_error', error?.message ?? error);
        // Soft-open: network failure must not delay package selection.
        setPaymentEntryGate('allowed');
      });
    return () => {
      cancelled = true;
    };
  }, [visible, refreshSubscription, showPaymentEntryDialog, isSubscribed]);

  useEffect(() => {
    if (!visible) {
      clearTimers();
      closeSse();
      doneRef.current = false;
      // Keep 'allowed' so the next open never flashes verify-wait UI for one frame.
      setPaymentEntryGate('allowed');
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

  /** Sync active checkout gateway from admin API — never invent ZenoPay on failure. */
  const reloadCheckoutConfig = useCallback(async ({ allowCache = true } = {}) => {
    setCheckoutProviderStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const cfg = await getCheckoutPaymentProviders();
      const provider = cfg.payment_provider;
      setCheckoutProvider(provider);
      checkoutProviderRef.current = provider;
      setCheckoutProviderStatus('ready');
      setCheckoutTestMode(cfg.auraxpay_test === true);
      void writeCachedCheckoutProvider(provider);
      console.log('[PremiumModal]', 'checkout_provider', provider, {
        auraxpay: cfg.auraxpay,
        auraxpay_test: cfg.auraxpay_test,
        sonicpesa: cfg.sonicpesa,
        source: 'network',
      });
      return cfg;
    } catch (e) {
      console.log('[PremiumModal]', 'checkout_provider_load_failed', e?.message ?? e);
      if (allowCache) {
        const cached = await readCachedCheckoutProvider();
        if (cached?.provider) {
          setCheckoutProvider(cached.provider);
          checkoutProviderRef.current = cached.provider;
          setCheckoutProviderStatus('ready');
          console.log('[PremiumModal]', 'checkout_provider', cached.provider, {
            source: 'verified_cache',
            savedAt: cached.savedAt || null,
          });
          return { payment_provider: cached.provider, fromCache: true };
        }
      }
      // Do NOT fall back to zenopay — leave unresolved so Lipia stays blocked.
      setCheckoutProvider(null);
      checkoutProviderRef.current = null;
      setCheckoutProviderStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    void (async () => {
      // Prefer a previously verified provider immediately (usually SonicPesa) while network loads.
      const cached = await readCachedCheckoutProvider();
      if (cancelled) return;
      if (cached?.provider) {
        setCheckoutProvider(cached.provider);
        checkoutProviderRef.current = cached.provider;
        setCheckoutProviderStatus('ready');
      } else {
        setCheckoutProvider(null);
        checkoutProviderRef.current = null;
        setCheckoutProviderStatus('loading');
      }
      await reloadCheckoutConfig({ allowCache: true });
    })();
    return () => {
      cancelled = true;
    };
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

  /** Prefetch device identity as soon as modal opens so Lipia never waits on identity. */
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    void getDeviceIdentity().then((identity) => {
      if (!cancelled) identityPrefetchRef.current = identity;
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  /** Keep identity warm on phone step (re-entry / retry). */
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

  useEffect(() => {
    checkoutProviderRef.current = checkoutProvider;
  }, [checkoutProvider]);

  const applyWaitingState = useCallback((incoming, { paymentConfirmed = false } = {}) => {
    const guard = reconcileGuardRef.current;
    if (!guard.tryAdvance(incoming)) {
      console.log('[PremiumModal]', 'waiting_state_rejected_stale', {
        incoming,
        best: guard.bestState,
      });
      return false;
    }
    setAppWaitingState(incoming);
    setPaymentProgressStep(mapWaitingStateToProgressStep(incoming));
    if (
      paymentConfirmed ||
      incoming === APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING ||
      incoming === APP_WAITING_STATE.ACTIVE
    ) {
      setPaymentProgressStep((prev) => Math.max(prev, 2));
    }
    return true;
  }, []);

  /** Payment verified active — unlock, show success dialog (no navigation until FUNGUA CHANNEL). */
  const finalizePaymentSuccess = useCallback(
    async (verified, fetchExpires = null) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setPaymentProgressStep(3);
      clearTimers();
      closeSse();
      applyWaitingState(APP_WAITING_STATE.ACTIVE);

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
      // Refresh device profile so User Center / intelligence sees the new package.
      void registerDeviceIntelligence().catch(() => {});

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
      const unlockLatencyMs = Date.now() - (pollStartedAtRef.current || Date.now());
      const confirmToUnlockMs = paymentConfirmedAtRef.current
        ? Date.now() - paymentConfirmedAtRef.current
        : null;
      console.log('[PremiumModal]', 'payment_success_dialog', {
        orderId: orderId ?? null,
        planName: forUnlock?.planName ?? selectedPlan?.name ?? null,
        expiresAt: forUnlock?.expiresAt ?? null,
        confirmation_to_unlock_ms: confirmToUnlockMs ?? unlockLatencyMs,
        poll_start_to_unlock_ms: unlockLatencyMs,
      });
      setStep(4);
      // Context unlock already applied. Avoid an immediate shared reverify race that can
      // briefly return inactive and re-lock channels before backend read-replicas catch up.
      // FUNGUA CHANNEL refreshes entitlement once before navigating.
    },
    [
      clearTimers,
      closeSse,
      unlockChannels,
      orderId,
      selectedPlan,
      checkoutProvider,
      applyWaitingState,
    ],
  );

  const handleTerminalConflict = useCallback(
    (waitingState, reason) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      closeSse();
      applyWaitingState(waitingState);
      console.log('[PremiumModal]', 'payment_terminal_conflict', { waitingState, reason });
      void reportPaymentTelemetry('terminal_conflict', {
        order_id: orderId ?? null,
        provider: checkoutProvider,
        waiting_state: waitingState,
        reason: String(reason ?? ''),
      });
    },
    [clearTimers, closeSse, applyWaitingState, orderId, checkoutProvider],
  );

  const handleDismissSuccess = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleOpenChannel = useCallback(() => {
    void (async () => {
      try {
        await refreshSubscription('payment-fungua-channel');
      } catch (e) {
        console.log('[PremiumModal]', 'fungua_refresh_error', e?.message ?? e);
      }
      try {
        onUnlockSuccess?.();
      } catch (e) {
        console.log('[PremiumModal]', 'onUnlockSuccess_error', e?.message ?? e);
      }
      onClose?.();
    })();
  }, [onUnlockSuccess, onClose, refreshSubscription]);

  /**
   * MFALME-style single activation tick per poll/SSE event (no blocking multi-minute loops).
   * Dedicated probes only — does not join shared context reverify.
   * After provider confirm, use light (parallel status) probes so waiting UI can exit in seconds.
   */
  const schedulePostPaymentActivationPolls = useCallback(
    async ({ paymentConfirmed = false, source = 'poll', light = false } = {}) => {
      if (doneRef.current) return false;
      if (paymentConfirmed) {
        setPaymentProgressStep(2);
        applyWaitingState(APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING, { paymentConfirmed: true });
      }

      try {
        const identity = await getDeviceIdentity();
        const { deviceId, deviceFingerprint } = identity;
        const useLight = light || paymentConfirmed;
        const result = await runPaymentActivationTick({
          deviceId,
          deviceFingerprint,
          identity,
          light: useLight,
        });

        if (result.active && result.subscription) {
          await finalizePaymentSuccess(result.subscription, result.fetchExpires);
          console.log('[PremiumModal]', 'payment_activation_success', { source, light: useLight });
          return true;
        }

        // Light status miss — one full verify/recover before waiting for the next poll.
        if (useLight && !String(source).startsWith('poll')) {
          const full = await runPaymentActivationTick({
            deviceId,
            deviceFingerprint,
            identity,
            light: false,
          });
          if (full.active && full.subscription) {
            await finalizePaymentSuccess(full.subscription, full.fetchExpires);
            console.log('[PremiumModal]', 'payment_activation_success', {
              source: `${source}:full`,
              light: false,
            });
            return true;
          }
        }

        console.log('[PAYMENT_SUCCESS_VERIFY]', 'activation_pending', {
          source,
          paymentConfirmed,
          light: useLight,
          active: result.subscription?.active,
          isActive: result.subscription?.isActive,
        });
        return false;
      } catch (e) {
        console.log('[PAYMENT_SUCCESS_VERIFY]', 'activation_error', e?.message ?? e);
        return false;
      }
    },
    [finalizePaymentSuccess, applyWaitingState],
  );

  const handleFailed = useCallback(
    (reason) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      closeSse();
      applyWaitingState(APP_WAITING_STATE.FAILED);
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
    [clearTimers, closeSse, applyWaitingState, checkoutProvider, orderId],
  );

  const pollOnce = useCallback(
    async (oid) => {
      if (doneRef.current) return;
      const gen = reconcileGuardRef.current.nextGeneration();
      const provider = checkoutProviderRef.current;
      try {
        const result = await resolveOrderPaymentStatus(oid, provider);
        if (doneRef.current || reconcileGuardRef.current.isStale(gen)) return;

        const waiting = result.appWaitingState ?? APP_WAITING_STATE.PAYMENT_PENDING;
        const paymentConfirmed =
          waiting === APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING ||
          waiting === APP_WAITING_STATE.ACTIVE ||
          result.status === 'SUCCESS' ||
          result.entitlementActive === true;

        if (paymentConfirmed && !paymentConfirmedAtRef.current) {
          paymentConfirmedAtRef.current = Date.now();
          console.log('[PremiumModal]', 'payment_confirmed', {
            orderId: oid,
            status: result.status,
            waiting,
            entitlementActive: result.entitlementActive === true,
            source: 'status-poll',
          });
        }

        applyWaitingState(waiting, { paymentConfirmed });

        if (waiting === APP_WAITING_STATE.PHONE_CONFLICT) {
          handleTerminalConflict(APP_WAITING_STATE.PHONE_CONFLICT, result.reason);
          return;
        }
        if (waiting === APP_WAITING_STATE.MOVED_TO_SIBLING_DEVICE) {
          handleTerminalConflict(APP_WAITING_STATE.MOVED_TO_SIBLING_DEVICE, result.reason);
          return;
        }
        if (waiting === APP_WAITING_STATE.MANUAL_REVIEW_REQUIRED) {
          handleTerminalConflict(APP_WAITING_STATE.MANUAL_REVIEW_REQUIRED, result.reason);
          return;
        }

        if (waiting === APP_WAITING_STATE.FAILED || result.status === 'FAILED') {
          handleFailed(result.reason);
          return;
        }

        if (reconcileGuardRef.current.isStale(gen)) return;

        // Money confirmed (SUCCESS) or entitlement already active → unlock NOW.
        // Never wait for verify/recover after provider payment success.
        if (isPaymentEntitlementConfirmed(result) || result.status === 'SUCCESS') {
          const hint = subscriptionHintFromPaymentStatusRaw(result.raw);
          const subscription = mergeCheckoutPlanIntoSubscription(
            {
              ...hint,
              active: true,
              isActive: true,
              expiresAt: latestExpiryIso(hint.expiresAt, result.expiresAt),
            },
            selectedPlan,
          );
          await finalizePaymentSuccess(subscription, result.expiresAt);
          console.log('[PremiumModal]', 'payment_activation_success', {
            source:
              isPaymentEntitlementConfirmed(result)
                ? 'payment-status-entitlement'
                : 'payment-status-success-immediate',
            waiting,
            entitlementActive: result.entitlementActive === true,
            status: result.status,
            confirmation_to_unlock_ms: paymentConfirmedAtRef.current
              ? Date.now() - paymentConfirmedAtRef.current
              : null,
          });
          return;
        }

        // PENDING only: do NOT run subscription verify/recover here — those Contabo
        // round-trips were blocking the next status poll for tens of seconds/minutes
        // after money was already taken (status stayed PENDING while probes ran).
        return;
      } catch (e) {
        if (reconcileGuardRef.current.isStale(gen)) return;
        const msg = String(e?.message ?? e ?? '');
        if (/429|rate limit/i.test(msg)) {
          applyWaitingState(APP_WAITING_STATE.RETRYING);
        }
        // transient network — keep polling
      }
    },
    [
      applyWaitingState,
      handleFailed,
      handleTerminalConflict,
      finalizePaymentSuccess,
      selectedPlan,
    ],
  );

  const scheduleNextPoll = useCallback(
    (oid) => {
      if (doneRef.current || !oid) return;
      const waiting = reconcileGuardRef.current.bestState;
      if (isTerminalWaitingState(waiting) && waiting !== APP_WAITING_STATE.ACTIVE) return;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      const elapsedMs = Date.now() - (pollStartedAtRef.current || Date.now());
      const delay = computePollIntervalMs({
        elapsedMs,
        waitingState: waiting,
        retryable: waiting === APP_WAITING_STATE.RETRYING,
        paymentConfirmed:
          waiting === APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING ||
          waiting === APP_WAITING_STATE.ACTIVE,
      });
      pollTimeoutRef.current = setTimeout(() => {
        if (doneRef.current) return;
        void pollOnce(oid).finally(() => scheduleNextPoll(oid));
      }, delay);
    },
    [pollOnce],
  );

  useEffect(() => {
    if (!visible || step !== 3 || !orderId || doneRef.current) return undefined;

    pollStartedAtRef.current = Date.now();
    reconcileGuardRef.current.reset();
    setAppWaitingState(APP_WAITING_STATE.PAYMENT_PENDING);

    void pollOnce(orderId).finally(() => scheduleNextPoll(orderId));

    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          // Countdown exhausted — leave waiting UI; do not spin forever.
          if (prev === 1 && !doneRef.current) {
            queueMicrotask(() => {
              if (!doneRef.current) {
                handleFailed('Muda wa malipo umeisha. Kama umelipa, subiri kidogo au fungua tena.');
              }
            });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearTimers();
  }, [visible, step, orderId, clearTimers, pollOnce, scheduleNextPoll, handleFailed]);

  /** Foreground resume — reconcile immediately after PIN/USSD or webhook activation. */
  useEffect(() => {
    if (!visible || step !== 3 || doneRef.current || !orderId) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void pollOnce(orderId).finally(() => scheduleNextPoll(orderId));
    });
    return () => sub.remove();
  }, [visible, step, orderId, pollOnce, scheduleNextPoll]);

  /**
   * Subscription stream unlock — only while waiting on a real create-order order_id.
   * create-order timeout is a hard init failure (no orphan pending-payment UI).
   */
  useEffect(() => {
    if (!visible || step !== 3 || !orderId || !waitingDeviceId || doneRef.current) return undefined;
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
          if (!paymentConfirmedAtRef.current) {
            paymentConfirmedAtRef.current = Date.now();
          }
          // Trust device subscription stream — verify lag must not keep channels locked.
          await finalizePaymentSuccess(
            mergeCheckoutPlanIntoSubscription(
              {
                active: true,
                isActive: true,
                expiresAt: payload.expiresAt ?? payload.expires_at ?? null,
                planName: payload.planName ?? payload.plan_name ?? null,
                planId: payload.planId ?? payload.plan_id ?? null,
                amount: payload.amount ?? null,
                startedAt: payload.startedAt ?? payload.started_at ?? null,
                remainingDays: payload.remainingDays ?? payload.remaining_days ?? null,
              },
              selectedPlan,
            ),
            payload.expiresAt ?? payload.expires_at ?? null,
          );
          console.log('[PremiumModal]', 'subscription_stream_active', {
            confirmation_to_unlock_ms: paymentConfirmedAtRef.current
              ? Date.now() - paymentConfirmedAtRef.current
              : null,
          });
        } catch {
          // ignore malformed stream payloads
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
  }, [visible, step, orderId, waitingDeviceId, closeSse, finalizePaymentSuccess, selectedPlan]);

  /** Admin / gateway payment_success SSE — unlock from payload when possible; else light probe. */
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
      subscribeRealtimeEvent(ev, (payload) => {
        if (doneRef.current) return;
        console.log('[PremiumModal]', 'payment_sse', ev);
        void (async () => {
          try {
            const payloadOrderId = pickPaymentSseOrderId(payload);
            if (payloadOrderId && orderId && payloadOrderId !== orderId) {
              console.log('[PremiumModal]', 'payment_sse_skipped_other_order', {
                event: ev,
                payloadOrderId,
              });
              return;
            }
            const orderMatched =
              Boolean(payloadOrderId && orderId && payloadOrderId === orderId);
            // Matching order_id for THIS payment is enough — skip slow device-set
            // resolution that previously delayed unlock by seconds after money success.
            if (!orderMatched && !(await sseGrantTargetsThisDevice(payload))) {
              console.log('[PremiumModal]', 'payment_sse_skipped_other_device', { event: ev });
              return;
            }
            if (!paymentConfirmedAtRef.current) {
              paymentConfirmedAtRef.current = Date.now();
              console.log('[PremiumModal]', 'payment_confirmed', {
                orderId: orderId ?? null,
                source: `sse:${ev}`,
                orderMatched,
              });
            }
            const inner =
              payload?.payload && typeof payload.payload === 'object'
                ? payload.payload
                : payload?.data && typeof payload.data === 'object'
                  ? payload.data
                  : payload;
            const payloadDeviceId = pickSubscriptionSseDeviceId(inner);
            const hasTrustedTarget =
              Boolean(payloadDeviceId) || orderMatched;
            const hint = parseInstantSubscriptionFromSse(payload, ev);
            if (orderMatched || (hasTrustedTarget && hint?.active === true)) {
              const forUnlock = mergeCheckoutPlanIntoSubscription(
                {
                  ...(hint && typeof hint === 'object' ? hint : {}),
                  active: true,
                  isActive: true,
                  expiresAt: hint?.expiresAt ?? null,
                },
                selectedPlan,
              );
              await finalizePaymentSuccess(forUnlock, hint?.expiresAt ?? null);
              console.log('[PremiumModal]', 'payment_activation_success', {
                source: orderMatched ? `sse-order:${ev}` : `sse-payload:${ev}`,
                confirmation_to_unlock_ms: paymentConfirmedAtRef.current
                  ? Date.now() - paymentConfirmedAtRef.current
                  : null,
              });
              return;
            }
          } catch {
            // fall through to probe
          }
          void schedulePostPaymentActivationPolls({
            paymentConfirmed: true,
            source: `sse:${ev}`,
            light: true,
          });
        })();
      }),
    );
    return () => {
      offs.forEach((off) => off());
    };
  }, [
    visible,
    step,
    orderId,
    selectedPlan,
    schedulePostPaymentActivationPolls,
    finalizePaymentSuccess,
  ]);

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
    if (submitting || payInFlightRef.current) return;
    if (paymentEntryGate !== 'allowed') {
      showPaymentEntryDialog('unknown');
      return;
    }
    if (!isPhoneValid) {
      Alert.alert('', 'Weka namba sahihi ya simu');
      return;
    }
    if (!selectedPlan?.id) {
      Alert.alert('', 'Chagua mpango');
      return;
    }
    // Instant hard block for THIS device only — never wait on network before UI.
    if (isSubscribed === true) {
      showPaymentEntryDialog('active');
      return;
    }

    // Never route through an unresolved or invented provider (esp. silent zenopay).
    let activeProvider = checkoutProvider ?? checkoutProviderRef.current;
    if (!activeProvider || checkoutProviderStatus === 'error') {
      setSubmitting(true);
      const cfg = await reloadCheckoutConfig({ allowCache: true });
      setSubmitting(false);
      activeProvider = cfg?.payment_provider ?? checkoutProviderRef.current;
      if (!activeProvider) {
        setPhoneGuardTitle(CHECKOUT_PROVIDER_UNAVAILABLE_TITLE);
        setPhoneGuardMessage(CHECKOUT_PROVIDER_UNAVAILABLE_MESSAGE);
        setCloseAfterGuardDialog(false);
        setPhoneGuardVisible(true);
        return;
      }
    }

    console.log('PAYMENT TRIGGERED');
    payInFlightRef.current = true;
    const normalizedPhone = phoneNumber.replace(/\s/g, '');

    doneRef.current = false;
    setOrderId(null);
    setFailureReason('');
    setPaymentProgressStep(1);
    setAppWaitingState(APP_WAITING_STATE.PAYMENT_PENDING);
    reconcileGuardRef.current.reset();
    pollStartedAtRef.current = Date.now();
    setSubmitting(true);
    // Stay on step 2 until create-order returns a real order_id.

    // Soft background verify — block only if THIS device is definitively active.
    void refreshSubscription('payment-submit-gate')
      .then((paymentGateResult) => {
        if (doneRef.current) return;
        const paymentGateClassification = classifyPaymentEntrySubscription(paymentGateResult);
        if (paymentGateClassification === 'active' || isSubscribed === true) {
          console.log('[PremiumModal]', 'payment_submit_gate_active_after_ui', {
            resolveSource: paymentGateResult?.resolveSource ?? null,
          });
          payInFlightRef.current = false;
          setSubmitting(false);
          showPaymentEntryDialog('active');
        } else if (paymentGateClassification !== 'inactive') {
          console.log('[PremiumModal]', 'payment_submit_gate_soft_allow', {
            classification: paymentGateClassification,
            resolveSource: paymentGateResult?.resolveSource ?? null,
            error: paymentGateResult?.error ?? null,
          });
        }
      })
      .catch((error) => {
        console.log('[PremiumModal]', 'payment_submit_gate_error', error?.message ?? error);
      });

    if (lipiaWatchdogRef.current) {
      clearTimeout(lipiaWatchdogRef.current);
      lipiaWatchdogRef.current = null;
    }
    lipiaWatchdogRef.current = setTimeout(() => {
      if (!payInFlightRef.current) return;
      console.warn('[PremiumModal]', 'lipia_create_order_watchdog_fired', {
        provider: activeProvider,
        planId: selectedPlan?.id ?? null,
      });
      payInFlightRef.current = false;
      void reportPaymentTelemetry('lipia_submitting_watchdog', {
        plan_id: selectedPlan?.id ?? null,
        provider: activeProvider,
      });
    }, LIPIA_SUBMITTING_WATCHDOG_MS);

    try {
      let identity = identityPrefetchRef.current;
      if (!identity?.deviceId) {
        identity = await getDeviceIdentity();
        identityPrefetchRef.current = identity;
      }
      const { deviceId, deviceFingerprint } = identity;
      setWaitingDeviceId(deviceId);

      const payPayload = {
        phone: normalizedPhone,
        plan_id: selectedPlan.id,
        amount: selectedPlan.price,
        device_id: deviceId,
        device_fingerprint: deviceFingerprint,
        install_instance_id: identity.installInstanceId ?? null,
        package_name: identity.packageName ?? null,
        package_android_id: identity.packageAndroidId ?? null,
        legacy_package_android_id: identity.legacyPackageAndroidId ?? null,
        stable_hardware_id: identity.stableHardwareId ?? null,
        displayed_account_id: identity.displayedAccountId ?? null,
        subscription_device_id: identity.subscriptionDeviceId ?? deviceId,
        legacy_device_fingerprint: identity.legacyDeviceFingerprint ?? null,
        identity_candidates: identity.identityCandidates ?? [],
      };
      void cacheSecurityPhone(payPayload.phone);
      const startPayment = resolveCheckoutStartPayment(activeProvider);
      console.log('[PremiumModal]', 'payment_start', {
        provider: activeProvider,
        planId: selectedPlan.id,
        deviceId: String(deviceId).slice(0, 8),
      });
      const { order_id: oid, expiresInSeconds } = await startPayment(payPayload);
      if (doneRef.current) return;
      const orderIdValue = oid != null ? String(oid).trim() : '';
      if (!orderIdValue) {
        throw new Error('Missing order_id from server');
      }
      // Real order only — enter waiting / STK confirmation UI now.
      setOrderId(orderIdValue);
      const wait =
        typeof expiresInSeconds === 'number' && expiresInSeconds > 0
          ? Math.floor(expiresInSeconds)
          : CREATE_ORDER_WAIT_SEC;
      setRemainingSeconds(wait);
      setWaitingDeviceId(deviceId);
      setStep(3);
      void reportPaymentTelemetry('started', {
        order_id: orderIdValue,
        plan_id: selectedPlan.id,
        provider: activeProvider,
        amount: selectedPlan.price,
      });
    } catch (e) {
      if (doneRef.current) return;
      if (
        e instanceof DeviceSubscriptionConflictError ||
        e?.name === 'DeviceSubscriptionConflictError'
      ) {
        console.log(
          '[PremiumModal]',
          'device_subscription_guard',
          JSON.stringify({
            code: e.code,
            provider: e.provider ?? activeProvider,
            httpStatus: e.httpStatus,
            path: e.path,
          }),
        );
        void reportPaymentTelemetry('device_subscription_conflict', {
          plan_id: selectedPlan?.id ?? null,
          provider: e.provider ?? activeProvider,
          code: e.code ?? null,
          reason: e.backendReason ?? null,
        });
        showPaymentEntryDialog('active');
        return;
      }
      if (e instanceof PhoneSubscriptionConflictError || e?.name === 'PhoneSubscriptionConflictError') {
        let identity = identityPrefetchRef.current;
        const deviceId = String(identity?.deviceId ?? identity?.subscriptionDeviceId ?? '');
        const existingDeviceId = String(e.conflict?.existingDeviceId ?? '').trim();
        const sameDeviceConflict =
          existingDeviceId &&
          (existingDeviceId === deviceId ||
            existingDeviceId === String(identity?.subscriptionDeviceId ?? '') ||
            existingDeviceId === String(identity?.displayedAccountId ?? ''));
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
            existingDeviceId: existingDeviceId ? `${existingDeviceId.slice(0, 8)}…` : null,
            sameDeviceConflict,
            thisDeviceId: deviceId ? `${deviceId.slice(0, 8)}` : null,
          }),
        );
        void reportPaymentTelemetry('phone_subscription_conflict', {
          plan_id: selectedPlan?.id ?? null,
          provider: e.provider ?? activeProvider,
          code: e.code ?? null,
          reason: e.backendReason ?? null,
          same_device: sameDeviceConflict === true,
        });
        if (sameDeviceConflict) {
          showPaymentEntryDialog('active');
          return;
        }
        // Other device owns a subscription under this phone number — THIS device
        // remains independent. Never show "Already Active" / phone-ownership block.
        setPhoneGuardTitle('Jaribu Tena');
        setPhoneGuardMessage(
          'Malipo hayakuanzishwa kwa sasa. Jaribu tena — kifurushi ni cha kifaa hiki pekee, si namba ya simu.',
        );
        setCloseAfterGuardDialog(false);
        setPhoneGuardVisible(true);
        setStep(2);
        return;
      }
      if (isPaymentCreateOrderTimeout(e)) {
        console.log(
          '[PremiumModal]',
          'create_order_timeout_blocked',
          JSON.stringify({ provider: activeProvider }),
        );
        void reportPaymentTelemetry('create_order_timeout', {
          plan_id: selectedPlan?.id ?? null,
          provider: activeProvider,
        });
        setFailureReason(CREATE_ORDER_TIMEOUT_MESSAGE);
        setStep(5);
        return;
      }
      const userMsg =
        e?.userMessage ??
        e?.message ??
        (/missing order_id/i.test(String(e?.message ?? ''))
          ? CREATE_ORDER_INIT_FAILED_MESSAGE
          : 'Imeshindwa kuanzisha malipo');
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
      let alertMsg = /missing order_id/i.test(String(e?.message ?? ''))
        ? CREATE_ORDER_INIT_FAILED_MESSAGE
        : userMsg;
      if (checkoutTestMode && e?.backendReason) {
        alertMsg = `${alertMsg}\n\n[Jaribio] ${e.backendReason}`;
      }
      void reportPaymentTelemetry('failure', {
        plan_id: selectedPlan?.id ?? null,
        provider: activeProvider,
        reason: e?.backendReason ?? userMsg,
      });
      setFailureReason(alertMsg);
      setStep(5);
    } finally {
      if (lipiaWatchdogRef.current) {
        clearTimeout(lipiaWatchdogRef.current);
        lipiaWatchdogRef.current = null;
      }
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
                    {/* Never show subscription verify-wait UI — verify is silent; plans open instantly. */}

                    {paymentEntryGate === 'allowed' && step === 1 && (
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

                    {paymentEntryGate === 'allowed' && step === 2 && (
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
                          {checkoutProviderStatus === 'error' && !checkoutProvider ? (
                            <View style={[styles.checkoutBadge, styles.step2GapClear]}>
                              <Text style={styles.checkoutBadgeText}>
                                Malipo hayako tayari — jaribu tena
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
                          {checkoutProviderStatus === 'error' && !checkoutProvider ? (
                            <Pressable
                              style={[styles.ctaWrap, styles.ctaDockBtn]}
                              onPress={() => {
                                void reloadCheckoutConfig({ allowCache: true });
                              }}
                            >
                              <LinearGradient
                                colors={ACCENT_GRADIENT}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.ctaGradient}
                              >
                                <Text style={styles.ctaText}>JARIBU TENA</Text>
                              </LinearGradient>
                            </Pressable>
                          ) : (
                            <Pressable
                              disabled={
                                !isPhoneValid ||
                                submitting ||
                                !checkoutProvider ||
                                checkoutProviderStatus === 'loading'
                              }
                              style={[
                                styles.ctaWrap,
                                styles.ctaDockBtn,
                                (!isPhoneValid ||
                                  submitting ||
                                  !checkoutProvider ||
                                  checkoutProviderStatus === 'loading') &&
                                  styles.ctaDisabled,
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
                          )}
                        </View>
                      </View>
                    )}

                    {paymentEntryGate === 'allowed' && step === 3 && (
                      <PaymentWaitingStep
                        selectedAmountDisplay={selectedAmountDisplay}
                        orderId={orderId}
                        remainingSeconds={remainingSeconds}
                        paymentProgressStep={paymentProgressStep}
                        appWaitingState={appWaitingState}
                        ringSpin={ringSpin}
                      />
                    )}

                    {paymentEntryGate === 'allowed' && step === 4 && (
                      <PaymentSuccessStep
                        details={successDetails}
                        onOpenChannel={handleOpenChannel}
                        onDismiss={handleDismissSuccess}
                      />
                    )}

                    {paymentEntryGate === 'allowed' && step === 5 && (
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
                  {paymentEntryGate === 'allowed' && step === 1 ? (
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
                  {paymentEntryGate === 'allowed' && step === 3 ? (
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
      onSawa={() => {
        setPhoneGuardVisible(false);
        if (closeAfterGuardDialog) {
          setCloseAfterGuardDialog(false);
          onClose?.();
        }
      }}
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

