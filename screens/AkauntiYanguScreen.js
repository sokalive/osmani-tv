import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import UpdateAppSection from '../components/UpdateAppSection';
import OmbaKifurushiSection from '../components/OmbaKifurushiSection';
import AccountUpdateSectionBoundary from '../components/AccountUpdateSectionBoundary';
import HamishaKifurushiModal from '../components/HamishaKifurushiModal';
import PremiumModal from '../components/PremiumModal';
import { redeemOfferCode, parseSubscriptionPayload } from '../api/subscription';
import { useDeviceIntelligence } from '../context/DeviceIntelligenceContext';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { formatSubscriptionExpiryDate } from '../lib/formatExpiry';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import {
  clearOfferCodeCooldown,
  readOfferCodeCooldownEndMs,
  writeOfferCodeCooldownEndMs,
} from '../lib/offerCodeCooldown';
import { getDeviceLabel } from '../lib/deviceLabel';
import { computeSubscriptionProgress } from '../lib/subscriptionMath';
import {
  resolveCanonicalExpiresAt,
  resolveDisplayDurationDays,
} from '../lib/subscriptionCanonical';
import {
  buildAccountDisplayDetails,
  enrichSubscriptionDetailsForDisplay,
  formatAccountPackagePriceLabel,
  resolveAccountDisplayExpiresAt,
  resolveAccountRemainingDays,
  resolveAssignedPlanDurationDays,
} from '../lib/accountSubscriptionDisplay';
import { formatAccountRemainingDays } from '../lib/accountRemainingDisplay';
import { readHydratableSubscriptionCache } from '../lib/subscriptionCacheHydrate';
import { subscriptionDetailsFromPlanSnapshot } from '../lib/subscriptionDetailsMerge';
import {
  getCachedPaymentPlansSync,
  hydratePaymentPlansCacheFromStorage,
  refreshPaymentPlansCache,
} from '../lib/paymentPlansCache';
import { traceAccountDisplay } from '../lib/accountDisplayTrace';
import { getScrollContentBottomPadding } from '../lib/tabBarLayout';

/** Extra scroll padding above pinned Update App footer */
const ACCOUNT_SCROLL_EXTRA = 24;
const COLORS = {
  background: '#0C0608',
  card: '#1A1D23',
  live: '#1BCB5A',
  yellow: '#FFCB3D',
  greenButton: '#1EC967',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
};

const HORIZONTAL_PADDING = 16;
const GRID_GAP = 12;
const { width: SCREEN_W } = Dimensions.get('window');
const STAT_CARD_W = (SCREEN_W - HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;

function StatCard({ icon, value, label }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={22} color={COLORS.yellow} style={styles.statIcon} />
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Backend-authoritative formatters. None of these grant or revoke access;
 * they purely render values that the verify endpoint already returned.
 */

/** Package length in days from verify payload (null when absent). */
function resolvePlanDurationDays(displayDetails) {
  return displayDetails?.assignedPlanDurationDays ?? resolveDisplayDurationDays(displayDetails);
}

function formatOfferCooldownMmSs(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}


export default function AkauntiYanguScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const bottomPad = getScrollContentBottomPadding(insets) + ACCOUNT_SCROLL_EXTRA;
  const [hamishaModalVisible, setHamishaModalVisible] = useState(false);
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [offerCodeInput, setOfferCodeInput] = useState('');

  const [redeemBusy, setRedeemBusy] = useState(false);
  const [cooldownEndMs, setCooldownEndMs] = useState(null);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState(0);
  const [deviceIdFull, setDeviceIdFull] = useState('');
  /** Bumps on each Account tab focus — remounts Update App section (post-OTA cache bust). */
  const [accountUpdateSectionKey, setAccountUpdateSectionKey] = useState(0);
  /** Last good package label — survive sparse verify/cache refresh payloads. */
  const lastPackageLabelRef = useRef(null);
  /** Last good duration days — survive sparse verify/cache refresh payloads. */
  const lastDurationDaysRef = useRef(null);
  const [paymentPlansCatalog, setPaymentPlansCatalog] = useState([]);
  const {
    isSubscribed,
    subscriptionExpiresAt,
    subscriptionDetails,
    subscriptionSyncLoaded,
    subscriptionRecoveryComplete,
    subscriptionVersion,
    availablePlans,
    refreshSubscription,
    showActivationSuccess,
    applyInstantSubscriptionState,
    isWithinInstantUnlockGrace,
  } = useOsmaniApp();
  const { guardUsage: guardDeviceIntelligence } = useDeviceIntelligence();

  const guardAccountAction = useCallback(
    (fn) => {
      if (guardDeviceIntelligence().ok === false) return;
      fn();
    },
    [guardDeviceIntelligence],
  );

  // Local "now" tick used ONLY by the visual progress bar interpolator.
  // Trust for access decisions still flows through the backend — see
  // `gateForPlayback` / `subscription_revoked` SSE handlers in context.
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isSubscribed) return undefined;
    const id = setInterval(() => setTickNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isSubscribed]);

  useEffect(() => {
    if (!isSubscribed) {
      lastPackageLabelRef.current = null;
      lastDurationDaysRef.current = null;
    }
  }, [isSubscribed, subscriptionVersion]);

  const catalogPlans = useMemo(() => {
    const fromContext = Array.isArray(availablePlans) ? availablePlans : [];
    const fromCache = Array.isArray(paymentPlansCatalog) ? paymentPlansCatalog : [];
    return [...fromContext, ...fromCache];
  }, [availablePlans, paymentPlansCatalog]);

  const displayDetails = useMemo(() => {
    const built = buildAccountDisplayDetails(
      subscriptionDetails,
      subscriptionExpiresAt,
      catalogPlans,
    );
    traceAccountDisplay('AkauntiYanguScreen.render', {
      paymentLabel: formatAccountPackagePriceLabel(built, catalogPlans),
      durationDays: resolvePlanDurationDays(built),
      catalogPlansCount: catalogPlans.length,
      subscriptionVersion,
    });
    return built;
  }, [subscriptionDetails, subscriptionExpiresAt, catalogPlans, subscriptionVersion]);

  useEffect(() => {
    if (!isSubscribed) {
      return;
    }
    const label = formatAccountPackagePriceLabel(displayDetails, catalogPlans);
    if (label) lastPackageLabelRef.current = label;
    const days = resolvePlanDurationDays(displayDetails);
    if (days != null) lastDurationDaysRef.current = days;
  }, [isSubscribed, displayDetails, catalogPlans]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!isSubscribed) return;
        try {
          const { cached } = await readHydratableSubscriptionCache();
          const snap = cached?.planSnapshot
            ? subscriptionDetailsFromPlanSnapshot(cached.planSnapshot, cached.expiresAt)
            : null;
          if (!snap) return;
          // Never overwrite sticky labels from disk when live verify already has values —
          // stale planSnapshot (old package mapping) would show wrong Price/Duration.
          if (!lastPackageLabelRef.current) {
            const label = formatAccountPackagePriceLabel(snap, catalogPlans);
            if (label) lastPackageLabelRef.current = label;
          }
          if (lastDurationDaysRef.current == null) {
            const days = resolvePlanDurationDays(
              buildAccountDisplayDetails(snap, cached?.expiresAt ?? null, catalogPlans),
            );
            if (days != null) lastDurationDaysRef.current = days;
          }
        } catch {
          // non-fatal
        }
      })();
    }, [isSubscribed, catalogPlans]),
  );

  const canonicalExpiresAt = useMemo(
    () => resolveCanonicalExpiresAt(subscriptionDetails, subscriptionExpiresAt),
    [subscriptionDetails, subscriptionExpiresAt],
  );

  // Box 4 display expiry — agrees with Admin plan remaining/duration (presentation only).
  const displayExpiresAt = useMemo(
    () =>
      resolveAccountDisplayExpiresAt(
        displayDetails,
        subscriptionExpiresAt,
        catalogPlans,
        tickNowMs,
      ),
    [displayDetails, subscriptionExpiresAt, catalogPlans, tickNowMs],
  );

  const deviceLabel = useMemo(() => getDeviceLabel(), []);
  const deviceShort =
    deviceIdFull.length >= 8 ? deviceIdFull.slice(0, 8).toUpperCase() : deviceIdFull || '—';

  // ---- Card-level derived values (data binding only) -----------------
  const progress = useMemo(() => {
    // Presentation only: ignore stacked startedAt/periodStart so progress /
    // countdown agree with the assigned Admin plan duration, not historical span.
    const planDays = resolveAssignedPlanDurationDays(displayDetails, catalogPlans);
    const base = computeSubscriptionProgress({
      startedAt: null,
      periodStartAt: null,
      expiresAt: displayExpiresAt ?? canonicalExpiresAt,
      planDurationDays: planDays,
      displayDurationDays: planDays,
      remainingSeconds:
        displayDetails?.remainingSeconds ?? displayDetails?.remaining_seconds ?? null,
      remainingDays: displayDetails?.remainingDays ?? displayDetails?.remaining_days ?? null,
      serverTime: displayDetails?.serverTime ?? null,
      serverTimeFetchedAt: displayDetails?.serverTimeFetchedAt ?? null,
      nowMsOverride: tickNowMs,
    });
    const accountDays = resolveAccountRemainingDays(
      displayDetails,
      canonicalExpiresAt,
      catalogPlans,
      tickNowMs,
    );
    if (accountDays != null && accountDays > 0) {
      return { ...base, remainingDays: accountDays };
    }
    return base;
  }, [displayDetails, canonicalExpiresAt, displayExpiresAt, catalogPlans, tickNowMs]);

  // Card 1: Malipo / Kifurushi — package amount only (never plan name).
  const paymentValue = useMemo(() => {
    if (!isSubscribed) return 'Hapana';
    const fresh = formatAccountPackagePriceLabel(displayDetails, catalogPlans);
    if (fresh) {
      lastPackageLabelRef.current = fresh;
      return fresh;
    }
    return lastPackageLabelRef.current ?? '—';
  }, [isSubscribed, displayDetails, catalogPlans]);

  // Card 2: real calendar days remaining, capped to the currently assigned plan.
  // This is display-only and never changes the stored subscription or expiry.
  const remainingCountdownValue = useMemo(() => {
    if (!isSubscribed) return '—';
    if (!canonicalExpiresAt) return '—';
    const days = resolveAccountRemainingDays(
      displayDetails,
      canonicalExpiresAt,
      catalogPlans,
      tickNowMs,
    );
    return days == null ? '—' : formatAccountRemainingDays(days);
  }, [isSubscribed, displayDetails, canonicalExpiresAt, catalogPlans, tickNowMs]);

  // Card 3: Muda wa Kifurushi — backend-aligned period length with catalog fill.
  const durationValue = useMemo(() => {
    if (!isSubscribed) return '—';
    const days = resolveAssignedPlanDurationDays(displayDetails, catalogPlans);
    if (days != null) {
      lastDurationDaysRef.current = days;
      return String(days);
    }
    return lastDurationDaysRef.current != null ? String(lastDurationDaysRef.current) : '—';
  }, [isSubscribed, displayDetails, catalogPlans]);

  // Card 5 (status)
  const statusLabel =
    isSubscribed || subscriptionSyncLoaded
      ? isSubscribed
        ? 'ACTIVE'
        : 'HUNA USAJILI'
      : 'INAPAKIA…';

  const syncCooldownFromStorage = useCallback(async () => {
    const end = await readOfferCodeCooldownEndMs();
    if (end != null && end > Date.now()) {
      setCooldownEndMs(end);
      setCooldownRemainingSec(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    } else {
      setCooldownEndMs(null);
      setCooldownRemainingSec(0);
      if (end != null) await clearOfferCodeCooldown();
    }
  }, []);

  useEffect(() => {
    if (!cooldownEndMs || cooldownEndMs <= Date.now()) {
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownEndMs - Date.now()) / 1000));
      setCooldownRemainingSec(left);
      if (left <= 0) {
        setCooldownEndMs(null);
        void clearOfferCodeCooldown();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownEndMs]);

  useFocusEffect(
    useCallback(() => {
      setAccountUpdateSectionKey((k) => k + 1);
      // Skip reverify during instant unlock grace — unlock already wrote canonical
      // boxes; a lagging inactive verify would only add visible wait/flicker.
      if (!isWithinInstantUnlockGrace?.()) {
        void refreshSubscription();
      }
      void syncCooldownFromStorage();
      void (async () => {
        const cached = getCachedPaymentPlansSync();
        if (cached?.length) setPaymentPlansCatalog(cached);
        const hydrated = await hydratePaymentPlansCacheFromStorage();
        if (hydrated?.length) setPaymentPlansCatalog(hydrated);
        const fresh = await refreshPaymentPlansCache({ reason: 'account-focus' });
        if (fresh?.length) setPaymentPlansCatalog(fresh);
      })();
      (async () => {
        try {
          const identity = await getDeviceIdentity();
          // Canonical verify / SSE / payment / request device_id (not display-only SSAID).
          setDeviceIdFull(identity.deviceId || identity.subscriptionDeviceId || '');
        } catch {
          setDeviceIdFull('');
        }
      })();
    }, [refreshSubscription, syncCooldownFromStorage, isWithinInstantUnlockGrace]),
  );

  const handleCopyDeviceId = useCallback(async () => {
    if (!deviceIdFull) return;
    await Clipboard.setStringAsync(deviceIdFull);
    Alert.alert('', 'Device ID imenakiliwa');
  }, [deviceIdFull]);

  const cooldownActive = cooldownRemainingSec > 0;

  const handleRedeemOfferCode = useCallback(async () => {
    if (guardDeviceIntelligence().ok === false) return;
    const raw = offerCodeInput.trim();
    if (!raw || redeemBusy || cooldownActive) return;
    setRedeemBusy(true);
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await redeemOfferCode(deviceId, deviceFingerprint, raw);
      if (r.ok) {
        const hint = parseSubscriptionPayload(r.raw, { active: true });
        if (hint?.active === true) {
          await applyInstantSubscriptionState(hint, 'offer-code-redeem');
        }
        const fresh = await refreshSubscription();
        showActivationSuccess(fresh ?? hint, 'offer_code');
        setOfferCodeInput('');
        navigation.navigate('Home');
        return;
      }
      if (r.locked) {
        const end = Date.now() + r.remainingSeconds * 1000;
        await writeOfferCodeCooldownEndMs(end);
        setCooldownEndMs(end);
        setCooldownRemainingSec(r.remainingSeconds);
        return;
      }
      Alert.alert('', r.message);
    } catch (e) {
      Alert.alert('', typeof e?.message === 'string' ? e.message : 'Jaribu tena baadaye.');
    } finally {
      setRedeemBusy(false);
    }
  }, [
    offerCodeInput,
    redeemBusy,
    cooldownActive,
    refreshSubscription,
    navigation,
    guardDeviceIntelligence,
    showActivationSuccess,
    applyInstantSubscriptionState,
  ]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.navigate('Home')}
            style={styles.backBtn}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.white} />
          </Pressable>
          <View style={styles.headerMain}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>B</Text>
              </View>
              <View style={styles.onlineDot} />
            </View>
            <View style={styles.headerTextCol}>
              <Text style={styles.companyTitle} numberOfLines={2}>
                {deviceLabel}
              </Text>
              <Text style={styles.deviceSubtitle}>ID: {deviceShort}</Text>
            </View>
          </View>
        </View>

        {isSubscribed && progress.ok ? (
          <View style={styles.infoCard}>
            <View style={styles.usageHeaderRow}>
              <Text style={styles.infoCardTitle}>Matumizi ya Kifurushi</Text>
              <Text style={styles.usagePercentText}>
                {Math.round(progress.percentRemaining)}%
              </Text>
            </View>
            <View style={styles.usageBarTrack}>
              <View
                style={[
                  styles.usageBarFill,
                  { width: `${Math.max(0, Math.min(100, progress.percentRemaining))}%` },
                ]}
              />
            </View>
            <Text style={styles.usageMetaText} numberOfLines={1}>
              {progress.remainingDays} siku zimebaki
              {progress.startMs && progress.expiresMs
                ? `  •  ${formatSubscriptionExpiryDate(new Date(progress.startMs).toISOString())} → ${formatSubscriptionExpiryDate(new Date(progress.expiresMs).toISOString())}`
                : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              icon="wallet-outline"
              value={paymentValue}
              label="Malipo / Kifurushi"
            />
            <StatCard
              icon="tv-outline"
              value={remainingCountdownValue}
              label="Muda Uliobaki wa Kifurushi"
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              icon="hourglass-outline"
              value={durationValue}
              label="Muda wa Kifurushi"
            />
            <StatCard
              icon="calendar-outline"
              value={formatSubscriptionExpiryDate(displayExpiresAt ?? canonicalExpiresAt)}
              label="Kuisha Tarehe"
            />
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Hali ya Usajili</Text>
          <Text style={[styles.statusBad, isSubscribed && styles.statusGood]}>
            {statusLabel}
          </Text>
        </View>

        <Pressable
          style={styles.hamishaTransferCardOuter}
          onPress={() => guardAccountAction(() => setHamishaModalVisible(true))}
          accessibilityRole="button"
          accessibilityLabel="Hamisha Kifurushi"
        >
          <LinearGradient
            colors={['#DC2626', '#16A34A']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.hamishaTransferCardGradient}
          >
            <Text style={styles.hamishaTransferCardTitle}>Hamisha Kifurushi</Text>
            <Text style={styles.infoCardBody}>HAMISHA KIFURUSHI CHAKO</Text>
          </LinearGradient>
        </Pressable>

        <Pressable
          style={styles.primaryWrap}
          onPress={() => guardAccountAction(() => setPremiumModalVisible(true))}
        >
          <LinearGradient
            colors={[COLORS.yellow, '#E5A020']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryGradient}
          >
            <Text style={styles.primaryText}>LIPIA TENA</Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.deviceSection}>
          <Text style={styles.deviceSectionTitle}>Device ID ya kifaa hiki</Text>
          <View style={styles.deviceRow}>
            <Text style={styles.deviceIdText} selectable>
              {deviceIdFull || 'Inapakia…'}
            </Text>
            <Pressable
              style={[styles.copyBtn, !deviceIdFull && styles.copyBtnDisabled]}
              onPress={handleCopyDeviceId}
              disabled={!deviceIdFull}
            >
              <Text style={styles.copyBtnText}>COPY</Text>
            </Pressable>
          </View>
          <Text style={styles.deviceFooter}>
            Tuma Device ID hii kwa admin wakati wa kuhamisha kifurushi
          </Text>
        </View>

        <View style={styles.offerSection}>
          <Text style={styles.offerSectionTitle}>WEKA CODE YA OFA ULIYOPEWA NA MUHUDUMU</Text>
          <Text style={styles.offerDescription}>Ingiza code uliyopewa na muhudumu</Text>
          {cooldownActive ? (
            <>
              <Text style={styles.offerCooldownWarning}>Umejaribu code nyingi zisizo sahihi</Text>
              <Text style={styles.offerCooldownTimer}>{formatOfferCooldownMmSs(cooldownRemainingSec)}</Text>
            </>
          ) : null}
          <TextInput
            style={[styles.offerInput, (cooldownActive || redeemBusy) && styles.offerInputDisabled]}
            value={offerCodeInput}
            onChangeText={setOfferCodeInput}
            placeholder="__________"
            placeholderTextColor="#6B7280"
            editable={!cooldownActive && !redeemBusy}
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardType="default"
          />
          <Pressable
            style={[styles.offerSubmitOuter, (cooldownActive || redeemBusy || !offerCodeInput.trim()) && styles.offerSubmitOuterDisabled]}
            onPress={() => guardAccountAction(() => void handleRedeemOfferCode())}
            disabled={cooldownActive || redeemBusy || !offerCodeInput.trim()}
          >
            <LinearGradient
              colors={[COLORS.yellow, '#E5A020']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.offerSubmitGradient}
            >
              {redeemBusy ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <Text style={styles.offerSubmitText}>THIBITISHA CODE</Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        <AccountUpdateSectionBoundary key={accountUpdateSectionKey}>
          <UpdateAppSection />
        </AccountUpdateSectionBoundary>

        <OmbaKifurushiSection />
      </ScrollView>

      <HamishaKifurushiModal
        visible={hamishaModalVisible}
        onClose={() => setHamishaModalVisible(false)}
      />

      <PremiumModal
        visible={premiumModalVisible}
        onClose={() => setPremiumModalVisible(false)}
        onUnlockSuccess={() => {
          navigation.navigate('Home');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  backBtn: {
    paddingVertical: 4,
    paddingRight: 8,
    marginRight: 4,
  },
  headerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    marginRight: 12,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2A2E37',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.live,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  headerTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  companyTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  deviceSubtitle: {
    marginTop: 4,
    color: COLORS.mutedText,
    fontSize: 13,
  },
  statsGrid: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  statCard: {
    width: STAT_CARD_W,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    minHeight: 108,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  statIcon: {
    marginBottom: 10,
  },
  statValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  statLabel: {
    color: COLORS.mutedText,
    fontSize: 12,
    lineHeight: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  hamishaTransferCardOuter: {
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  hamishaTransferCardGradient: {
    padding: 16,
  },
  hamishaTransferCardTitle: {
    color: COLORS.mutedText,
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  infoCardTitle: {
    color: COLORS.mutedText,
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  statusBad: {
    color: '#EF4444',
    fontSize: 18,
    fontWeight: '800',
  },
  statusGood: {
    color: '#4ADE80',
  },
  infoCardBody: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  usageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  usagePercentText: {
    color: COLORS.yellow,
    fontSize: 13,
    fontWeight: '700',
  },
  usageBarTrack: {
    height: 8,
    borderRadius: 6,
    backgroundColor: '#2A2E37',
    overflow: 'hidden',
    marginBottom: 8,
  },
  usageBarFill: {
    height: '100%',
    backgroundColor: COLORS.yellow,
    borderRadius: 6,
  },
  usageMetaText: {
    color: COLORS.mutedText,
    fontSize: 12,
    lineHeight: 16,
  },
  primaryWrap: {
    marginTop: 20,
    marginBottom: 24,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  primaryGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deviceSection: {
    marginBottom: 8,
  },
  deviceSectionTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 12,
  },
  deviceIdText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
  },
  copyBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.greenButton,
  },
  copyBtnDisabled: {
    opacity: 0.45,
  },
  copyBtnText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 13,
  },
  deviceFooter: {
    color: COLORS.mutedText,
    fontSize: 12,
    lineHeight: 18,
  },
  offerSection: {
    marginTop: 24,
    marginBottom: 16,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.12)',
  },
  offerSectionTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  offerDescription: {
    color: COLORS.mutedText,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  offerCooldownWarning: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  offerCooldownTimer: {
    color: COLORS.yellow,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 14,
  },
  offerInput: {
    backgroundColor: '#151922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: COLORS.white,
    marginBottom: 14,
  },
  offerInputDisabled: {
    opacity: 0.5,
  },
  offerSubmitOuter: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  offerSubmitOuterDisabled: {
    opacity: 0.55,
  },
  offerSubmitGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerSubmitText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
