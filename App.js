import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  createNavigationContainerRef,
  DarkTheme,
  NavigationContainer,
  useFocusEffect,
} from '@react-navigation/native';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { MaintenanceHomeCentered } from './components/MaintenanceScreen';
import EmergencyModal from './components/EmergencyModal';
import PremiumModal from './components/PremiumModal';
import SubscriptionExpiryReminderModal from './components/SubscriptionExpiryReminderModal';
import ManualSubscriptionGiftModal from './components/ManualSubscriptionGiftModal';
import PopupSettingsModal from './components/PopupSettingsModal';
import TransferConfirmModal from './components/TransferConfirmModal';
import TransferredAwayModal from './components/TransferredAwayModal';
import UpdateOverlay from './components/UpdateOverlay';
import OtaDebugOverlay, { OtaDebugTitleTap } from './components/OtaDebugOverlay';
import WhatsAppFloatingButtonGate from './components/WhatsAppFloatingButtonGate';
import AkauntiYanguScreen from './screens/AkauntiYanguScreen';
import ChannelPlayerScreen from './screens/ChannelPlayerScreen';
import { OsmaniAppProvider, useOsmaniApp } from './context/OsmaniAppContext';
import {
  ModalSheetCoordinatorProvider,
  useModalSheetCoordinator,
  useRegisterBlockingSheet,
} from './context/ModalSheetCoordinatorContext';
import { BASE_URL } from './api';
import { acknowledgeManualGift } from './api/subscription';
import { trackInstallOnce } from './api/analytics';
import { startPresence, stopPresence } from './lib/presenceTracker';
import { startRealtimeSync, stopRealtimeSync } from './lib/realtimeSync';
import { startUpdateClient, stopUpdateClient } from './lib/updateClient';
import { setupOneSignal } from './lib/oneSignal';
import { resolveMainTabFromOsmaniUrl } from './lib/osmaniDeepLink';
import { resolveStream } from './lib/channelStream';
import { getScrollContentBottomPadding, getTabBarTotalHeight } from './lib/tabBarLayout';
import { isBannerVisibleAt, normalizeBanner } from './lib/normalizeBanner';
import { buildPlayerChannelFromRow } from './lib/playerChannelFromRow';
import { computeSubscriptionProgress } from './lib/subscriptionMath';
import {
  consumeHomeExpiryReminder,
  isHomeExpiryReminderConsumed,
} from './lib/subscriptionReminderSession';
import { getDeviceIdentity } from './lib/deviceIdentity';
import {
  clearPendingManualGiftKey,
  readManualGiftAck,
  readPendingManualGiftKey,
  writeManualGiftAck,
  writePendingManualGiftKey,
} from './lib/manualGiftAck';
import BannerCarousel, { BannerCarouselSkeleton } from './components/BannerCarousel';
import {
  channelAppearsOnNavigatorTab,
  channelIsFeatured,
  channelIsPopular,
  compareHomeMixChannels,
  getChannelTabKeys,
  matchesHomePillFilter,
} from './lib/channelTabVisibility';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Single ref for WhatsApp FAB visibility (must not use hooks outside a navigator). */
const navigationRef = createNavigationContainerRef();

/** Cold start: OneSignal may open before `NavigationContainer` is ready — queue then flush in `onReady`. */
const pendingOsmaniUrlRef = { current: /** @type {string | null} */ (null) };
const openOsmaniUrlRef = {
  current: /** @param {string} _url */ (_url) => {},
};

const osmaniLinking = {
  prefixes: ['osmani://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: 'home',
          Sports: 'sports',
          Tamthilia: 'tamthilia',
          'Akaunti Yangu': 'akaunti',
        },
      },
    },
  },
};

/** Used only when channel API omits stream URLs (playback fallback). */
const DEFAULT_STREAM_URI =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const { width } = Dimensions.get('window');
const HORIZONTAL_PADDING = 16;
const GRID_GAP = 12;
const CARD_WIDTH = (width - HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 4) / 3);
/** Home “Maarufu / Vipengele” horizontal strips */
const HIGHLIGHT_CARD_WIDTH = 152;
const HIGHLIGHT_CARD_HEIGHT = Math.round((HIGHLIGHT_CARD_WIDTH * 4) / 3);
const CAROUSEL_SLIDE_WIDTH = width - HORIZONTAL_PADDING * 2;

const COLORS = {
  /** Near-black with subtle deep red — stadium / premium night pitch */
  background: '#0C0608',
  card: '#151014',
  live: '#1BCB5A',
  free: '#2AAE5E',
  yellow: '#FFCB3D',
  greenButton: '#1EC967',
  filterPill: '#2A2E37',
  filterSelected: '#3A4151',
  mutedText: '#A1A8B5',
  nav: '#12090C',
  white: '#FFFFFF',
  /** Bottom tabs — classic warm “Home” emphasis */
  tabActive: '#FFB347',
  tabInactive: '#DDE3EC',
};

const filters = ['Zote', 'Trending', 'Sports', 'Tamthilia'];

/** Full image URL for API `thumbnail` (absolute or `/uploads/...`). */
function resolveChannelThumbnailUri(raw) {
  const rel =
    raw?.thumbnail != null
      ? String(raw.thumbnail).trim()
      : raw?.thumbnail_url != null
        ? String(raw.thumbnail_url).trim()
        : '';
  const abs = raw?.thumbnailUrl != null ? String(raw.thumbnailUrl).trim() : '';
  if (abs.startsWith('http')) return abs;
  if (rel.startsWith('http')) return rel;
  if (rel.startsWith('/')) return `${BASE_URL}${rel}`;
  if (rel.length > 0) return `${BASE_URL}/${rel}`;
  return null;
}

function placeholderLetterFromName(name) {
  const s = String(name ?? '').trim();
  for (let i = 0; i < s.length; i++) {
    if (/[a-zA-Z0-9]/.test(s[i])) return s[i].toUpperCase();
  }
  return '?';
}

function channelVisibleInApp(raw) {
  const showInApp =
    raw?.showInApp !== undefined
      ? Boolean(raw.showInApp)
      : raw?.show_in_app !== undefined
        ? Boolean(raw.show_in_app)
        : true;
  const isActive =
    raw?.isActive !== undefined
      ? Boolean(raw.isActive)
      : raw?.active !== undefined
        ? Boolean(raw.active)
        : true;
  return showInApp && isActive;
}

function catalogGridSectionTitle(navigatorTabKey, selectedFilter) {
  if (navigatorTabKey === 'sports') return 'Michezo';
  if (navigatorTabKey === 'tamthilia') return 'Tamthilia';
  if (selectedFilter === 'Sports') return 'Michezo';
  if (selectedFilter === 'Tamthilia') return 'Tamthilia';
  if (selectedFilter === 'Trending') return 'Chaneli Live';
  return 'Chaneli';
}

function findServerHealthForChannel(serverHealth, name) {
  if (!serverHealth || !Array.isArray(serverHealth.channels)) return null;
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return serverHealth.channels.find((row) => String(row?.name ?? '').trim().toLowerCase() === wanted) || null;
}

function mapApiChannelToCard(raw, index, freeMode = false, serverHealth = null) {
  const name = raw?.name != null ? String(raw.name) : `Channel ${index + 1}`;
  const stableId =
    raw?.id != null && String(raw.id).length > 0 ? String(raw.id) : `ch-${index}-${name.slice(0, 24)}`;
  const health = findServerHealthForChannel(serverHealth, name);
  const healthStatus = typeof health?.status === 'string' ? health.status.toLowerCase() : '';
  const isLiveFromApi = raw?.isLive !== undefined ? Boolean(raw.isLive) : Boolean(raw?.live);
  const isLive =
    healthStatus === 'online'
      ? true
      : healthStatus === 'offline'
        ? false
        : isLiveFromApi;
  const isHD = raw?.isHD !== undefined ? Boolean(raw.isHD) : raw?.hd !== false;
  const isPremiumApi =
    raw?.accessType === 'premium' || Boolean(raw?.accessPremium === true || raw?.access_premium === true);
  const isPremium = freeMode ? false : isPremiumApi;
  const category = raw?.category != null ? String(raw.category) : '';
  const resolved = resolveStream(raw);
  const thumbnailUri = resolveChannelThumbnailUri(raw);
  const playerChannel = buildPlayerChannelFromRow(raw, index, freeMode);
  return {
    id: stableId,
    title: name,
    subtitle: category || 'Live Channel',
    showHD: isHD,
    liveLabel: isLive ? 'LIVE' : 'OFFLINE',
    livePillColor: isLive ? '#DC2626' : '#4B5563',
    accessBadge: isPremium ? 'KULIPIA' : 'BURE',
    accessBadgeColor: isPremium ? COLORS.yellow : COLORS.free,
    thumbnailUri,
    placeholderLetter: placeholderLetterFromName(name),
    bottomTab: String(
      raw?.bottom_tab ?? raw?.bottomTab ?? raw?.bottomTabsDisplay ?? category ?? '',
    ).trim(),
    streamUrl: resolved || DEFAULT_STREAM_URI,
    playerChannel,
    isPremium,
  };
}

const HOME_EXPIRY_REMINDER_MS = 10 * 60 * 1000;

const REMINDER_DEBUG_PREFIX = '[REMINDER_COORD]';
function reminderCoordLog(...args) {
  if (__DEV__) console.log(REMINDER_DEBUG_PREFIX, ...args);
}

function ChannelCatalogScreen({
  navigation,
  navigatorTabKey = 'home',
  enableHomeExpiryReminder = false,
}) {
  const insets = useSafeAreaInsets();
  const {
    freeMode,
    emergencyMode,
    maintenanceMode,
    rawChannels,
    rawBanners,
    serverHealth,
    loading,
    error,
    refresh,
    isSubscribed,
    subscriptionExpiresAt,
    subscriptionDetails,
    subscriptionVersion,
    verifySubscriptionBeforePlay,
    requestEmergencyModal,
  } = useOsmaniApp();
  const [selectedFilter, setSelectedFilter] = useState('Zote');
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [expiryReminderVisible, setExpiryReminderVisible] = useState(false);
  const [expiryReminderDisplayDays, setExpiryReminderDisplayDays] = useState(2);
  const [manualGiftVisible, setManualGiftVisible] = useState(false);
  const [manualGiftAckBusy, setManualGiftAckBusy] = useState(false);
  const [manualGiftAckLoaded, setManualGiftAckLoaded] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bannerVisibilityClock, setBannerVisibilityClock] = useState(() => Date.now());

  /** Once per mount: log real API shape + derived section (production-safe diagnostic). */
  const catalogShapeLoggedRef = useRef(false);
  useEffect(() => {
    if (catalogShapeLoggedRef.current || !Array.isArray(rawChannels) || rawChannels.length === 0) return;
    catalogShapeLoggedRef.current = true;
    const r = rawChannels[0];
    console.log('[CATALOG_SHAPE]', {
      sampleKeys: r && typeof r === 'object' ? Object.keys(r).sort() : [],
      display_section: r?.display_section ?? r?.displaySection ?? null,
      category: r?.category ?? null,
      visibleTabs: r?.visibleTabs ?? r?.visible_tabs ?? null,
      bottom_tab: r?.bottom_tab ?? null,
      bottomTab: r?.bottomTab ?? null,
      bottomTabsDisplay: r?.bottomTabsDisplay ?? null,
      type: r?.type ?? null,
      resolvedTabKeys: r && typeof r === 'object' ? [...getChannelTabKeys(r)].sort().join(',') : null,
    });
  }, [rawChannels]);

  const isSubscribedRef = useRef(isSubscribed);
  const subscriptionDetailsRef = useRef(subscriptionDetails);
  const subscriptionExpiresAtRef = useRef(subscriptionExpiresAt);
  const deferredReminderRef = useRef(false);
  const deferredManualGiftRef = useRef(false);
  const pendingGiftBlocksExpiryRef = useRef(false);
  const tryShowExpiryReminderRef = useRef(() => false);
  const tryShowManualGiftRef = useRef(async () => false);
  const manualGiftVisibleRef = useRef(false);
  const expiryReminderVisibleRef = useRef(false);
  isSubscribedRef.current = isSubscribed;
  subscriptionDetailsRef.current = subscriptionDetails;
  subscriptionExpiresAtRef.current = subscriptionExpiresAt;

  const {
    isBlockingSheetActive,
    blockingSheetCount,
    blockingSheetIds,
  } = useModalSheetCoordinator();

  const catalogBlockingSuffix = enableHomeExpiryReminder
    ? 'home'
    : navigatorTabKey === 'sports'
      ? 'sports'
      : navigatorTabKey === 'tamthilia'
        ? 'tamthilia'
        : 'other';

  useRegisterBlockingSheet(`catalog-premium-${catalogBlockingSuffix}`, premiumModalVisible);
  useRegisterBlockingSheet(`catalog-manual-gift-${catalogBlockingSuffix}`, manualGiftVisible);

  useEffect(() => {
    manualGiftVisibleRef.current = manualGiftVisible;
  }, [manualGiftVisible]);

  useEffect(() => {
    expiryReminderVisibleRef.current = expiryReminderVisible;
  }, [expiryReminderVisible]);

  useEffect(() => {
    let cancelled = false;
    if (!enableHomeExpiryReminder) {
      setManualGiftAckLoaded(false);
      return undefined;
    }
    Promise.all([readManualGiftAck(), readPendingManualGiftKey()])
      .then(() => {
        if (!cancelled) setManualGiftAckLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setManualGiftAckLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enableHomeExpiryReminder]);

  const syncPendingGiftBlocking = useCallback(async () => {
    try {
      const [ack, pending] = await Promise.all([readManualGiftAck(), readPendingManualGiftKey()]);
      const dk = subscriptionDetailsRef.current?.manualGiftAckKey ?? null;
      pendingGiftBlocksExpiryRef.current =
        (dk != null && dk !== '' && ack !== dk) || (pending !== '' && ack !== pending);
    } catch {
      pendingGiftBlocksExpiryRef.current = manualGiftVisibleRef.current;
    }
  }, []);

  const tryShowManualGift = useCallback(
    async (source) => {
      const detailsKey = subscriptionDetailsRef.current?.manualGiftAckKey ?? null;
      const subscribed = isSubscribedRef.current;
      console.log('[MANUAL_GIFT]', 'popup_try', source, {
        enableHomeExpiryReminder,
        manualGiftAckLoaded,
        manualGiftAckKey: detailsKey ?? null,
        isSubscribed: subscribed,
        blockingSheetActive: isBlockingSheetActive,
        blockingSheetIds,
        premiumModalVisible,
        expiryReminderVisible: expiryReminderVisibleRef.current,
      });
      if (!enableHomeExpiryReminder) {
        console.log('[MANUAL_GIFT]', 'popup_skip', source, 'not_home_tab');
        return false;
      }
      if (!manualGiftAckLoaded) {
        console.log('[MANUAL_GIFT]', 'popup_skip', source, 'ack_storage_not_loaded');
        return false;
      }
      await syncPendingGiftBlocking();

      const ack = await readManualGiftAck();
      const pending = await readPendingManualGiftKey();

      if (detailsKey != null && detailsKey !== '' && ack === detailsKey) {
        await clearPendingManualGiftKey();
        await syncPendingGiftBlocking();
        console.log('[MANUAL_GIFT]', 'popup_skip', source, 'already_acked_matches_verify');
        return false;
      }

      let outstanding = null;
      if (detailsKey != null && detailsKey !== '' && ack !== detailsKey) {
        outstanding = detailsKey;
      } else if (pending !== '' && ack !== pending) {
        outstanding = pending;
      }

      console.log('[MANUAL_GIFT]', 'popup_ack_compare', source, {
        storedAck: ack || '(empty)',
        pending,
        detailsKey,
        outstanding,
      });

      if (!outstanding || !subscribed) {
        console.log('[MANUAL_GIFT]', 'popup_skip', source, 'no_outstanding_or_not_subscribed');
        return false;
      }

      if (expiryReminderVisibleRef.current) {
        deferredManualGiftRef.current = true;
        reminderCoordLog('manual_gift_defer', source, 'reason=expiry_visible');
        console.log('[MANUAL_GIFT]', 'popup_defer', source, 'expiry_reminder_visible');
        return false;
      }
      if (isBlockingSheetActive) {
        deferredManualGiftRef.current = true;
        reminderCoordLog('manual_gift_defer', source, 'reason=blocking_sheets');
        console.log('[MANUAL_GIFT]', 'popup_defer', source, 'blocking_sheets', blockingSheetIds);
        return false;
      }
      if (premiumModalVisible) {
        deferredManualGiftRef.current = true;
        reminderCoordLog('manual_gift_defer', source, 'reason=premium_open');
        console.log('[MANUAL_GIFT]', 'popup_defer', source, 'premium_open');
        return false;
      }
      deferredManualGiftRef.current = false;
      await writePendingManualGiftKey(outstanding);
      await syncPendingGiftBlocking();
      setManualGiftVisible(true);
      reminderCoordLog('manual_gift_open', source, { key: outstanding });
      console.log('[MANUAL_GIFT]', 'popup_open', source, { key: outstanding });
      return true;
    },
    [
      enableHomeExpiryReminder,
      manualGiftAckLoaded,
      isBlockingSheetActive,
      blockingSheetIds,
      premiumModalVisible,
      syncPendingGiftBlocking,
    ],
  );

  tryShowManualGiftRef.current = tryShowManualGift;

  const tryShowExpiryReminder = useCallback(
    (source) => {
      if (!enableHomeExpiryReminder) {
        reminderCoordLog('skip', source, 'reason=not_home_catalog');
        return false;
      }
      if (pendingGiftBlocksExpiryRef.current || manualGiftVisibleRef.current) {
        deferredReminderRef.current = true;
        reminderCoordLog('defer', source, 'reason=manual_gift_blocking');
        return false;
      }
      if (isHomeExpiryReminderConsumed()) {
        reminderCoordLog('skip', source, 'reason=session_already_consumed');
        return false;
      }
      if (isBlockingSheetActive) {
        deferredReminderRef.current = true;
        reminderCoordLog('defer', source, 'reason=blocking_sheets', {
          blockingSheetCount,
          blockingSheetIds,
          premiumModalVisible,
        });
        return false;
      }
      if (!isSubscribedRef.current) {
        reminderCoordLog('skip', source, 'reason=not_subscribed');
        return false;
      }
      const details = subscriptionDetailsRef.current;
      const expiresAt = subscriptionExpiresAtRef.current;
      const progress = computeSubscriptionProgress({
        startedAt: details?.startedAt ?? null,
        expiresAt: details?.expiresAt ?? expiresAt ?? null,
        planDurationDays: details?.planDurationDays ?? null,
        serverTime: details?.serverTime ?? null,
        serverTimeFetchedAt: details?.serverTimeFetchedAt ?? null,
        nowMsOverride: Date.now(),
      });
      if (!progress.ok || progress.remainingDays > 2) {
        reminderCoordLog('skip', source, 'reason=not_eligible', {
          progressOk: progress.ok,
          remainingDays: progress.remainingDays,
        });
        return false;
      }
      const displayDays = Math.min(Math.max(progress.remainingDays, 1), 2);
      consumeHomeExpiryReminder();
      setExpiryReminderDisplayDays(displayDays);
      setExpiryReminderVisible(true);
      deferredReminderRef.current = false;
      reminderCoordLog('open', source, {
        displayDays,
        blockingSheetCount,
        premiumModalVisible,
      });
      return true;
    },
    [
      enableHomeExpiryReminder,
      isBlockingSheetActive,
      blockingSheetCount,
      blockingSheetIds,
      premiumModalVisible,
    ],
  );

  tryShowExpiryReminderRef.current = tryShowExpiryReminder;

  useFocusEffect(
    useCallback(() => {
      if (!enableHomeExpiryReminder) return undefined;
      let cancelled = false;
      const tid = setTimeout(() => {
        if (cancelled) return;
        reminderCoordLog('timer_fire');
        tryShowExpiryReminderRef.current('timer');
      }, HOME_EXPIRY_REMINDER_MS);
      return () => {
        cancelled = true;
        clearTimeout(tid);
      };
    }, [enableHomeExpiryReminder]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!enableHomeExpiryReminder) return undefined;
      const tid = setTimeout(() => {
        void tryShowManualGiftRef.current('focus');
      }, 500);
      return () => clearTimeout(tid);
    }, [enableHomeExpiryReminder]),
  );

  useEffect(() => {
    if (!enableHomeExpiryReminder || !manualGiftAckLoaded) return;
    void tryShowManualGiftRef.current('subscription_update');
  }, [
    enableHomeExpiryReminder,
    manualGiftAckLoaded,
    subscriptionVersion,
    subscriptionDetails?.manualGiftAckKey,
  ]);

  useEffect(() => {
    if (!enableHomeExpiryReminder || !manualGiftAckLoaded) return;
    void syncPendingGiftBlocking();
  }, [
    enableHomeExpiryReminder,
    manualGiftAckLoaded,
    subscriptionVersion,
    subscriptionDetails?.manualGiftAckKey,
    manualGiftVisible,
    syncPendingGiftBlocking,
  ]);

  useEffect(() => {
    if (!enableHomeExpiryReminder) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void tryShowManualGiftRef.current('app_resume');
    });
    return () => sub.remove();
  }, [enableHomeExpiryReminder]);

  useEffect(() => {
    if (!enableHomeExpiryReminder) return;
    if (isBlockingSheetActive) return;
    if (!deferredReminderRef.current) return;
    deferredReminderRef.current = false;
    reminderCoordLog('retry_after_unblock', {
      blockingSheetIds,
      blockingSheetCount,
    });
    tryShowExpiryReminderRef.current('after_unblock');
  }, [isBlockingSheetActive, enableHomeExpiryReminder, blockingSheetIds, blockingSheetCount]);

  useEffect(() => {
    if (!enableHomeExpiryReminder) return;
    if (isBlockingSheetActive) return;
    if (!deferredManualGiftRef.current) return;
    deferredManualGiftRef.current = false;
    void tryShowManualGiftRef.current('after_unblock');
  }, [isBlockingSheetActive, enableHomeExpiryReminder, blockingSheetIds, blockingSheetCount]);

  useEffect(() => {
    if (!enableHomeExpiryReminder) return;
    if (premiumModalVisible) return;
    if (!deferredManualGiftRef.current) return;
    deferredManualGiftRef.current = false;
    void tryShowManualGiftRef.current('after_premium_close');
  }, [premiumModalVisible, enableHomeExpiryReminder]);

  useEffect(() => {
    if (!enableHomeExpiryReminder) return;
    if (expiryReminderVisible) return;
    if (!deferredManualGiftRef.current) return;
    deferredManualGiftRef.current = false;
    void tryShowManualGiftRef.current('after_expiry_close');
  }, [expiryReminderVisible, enableHomeExpiryReminder]);

  const dismissExpiryReminder = useCallback(() => {
    setExpiryReminderVisible(false);
  }, []);

  const acknowledgeManualGiftPress = useCallback(async () => {
    const dk = subscriptionDetailsRef.current?.manualGiftAckKey ?? null;
    const pending = await readPendingManualGiftKey();
    const key =
      dk != null && dk !== ''
        ? dk
        : pending !== ''
          ? pending
          : null;
    if (!key) {
      console.log('[MANUAL_GIFT]', 'ack_press_skip_no_key');
      return;
    }
    setManualGiftAckBusy(true);
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      await acknowledgeManualGift(deviceId, deviceFingerprint, key);
      await writeManualGiftAck(key);
      await clearPendingManualGiftKey();
      pendingGiftBlocksExpiryRef.current = false;
      manualGiftVisibleRef.current = false;
      setManualGiftVisible(false);
      console.log('[MANUAL_GIFT]', 'ack_complete', { key });
      void syncPendingGiftBlocking();
      setTimeout(() => {
        tryShowExpiryReminderRef.current('after_manual_gift_close');
      }, 0);
    } catch (e) {
      Alert.alert(
        'Hitilafu',
        typeof e?.message === 'string' ? e.message : 'Huwezi kuthibitisha sasa. Jaribu tena.',
      );
    } finally {
      setManualGiftAckBusy(false);
    }
  }, [syncPendingGiftBlocking]);

  const onRenewFromExpiryReminder = useCallback(() => {
    setExpiryReminderVisible(false);
    setPremiumModalVisible(true);
  }, []);

  const mountManualGiftModal = enableHomeExpiryReminder && manualGiftVisible;

  const mountReminderModal =
    enableHomeExpiryReminder && expiryReminderVisible && !isBlockingSheetActive;

  useEffect(() => {
    if (!Array.isArray(rawBanners) || rawBanners.length === 0) return undefined;
    const id = setInterval(() => setBannerVisibilityClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [rawBanners]);

  const listBottomPadding = getScrollContentBottomPadding(insets);

  const homeZotePool = useMemo(() => {
    if (maintenanceMode) return [];
    if (navigatorTabKey !== 'home') return [];
    return rawChannels
      .filter(channelVisibleInApp)
      .filter((r) => channelAppearsOnNavigatorTab(r, 'home'));
  }, [rawChannels, maintenanceMode, navigatorTabKey]);

  const popularChannelCards = useMemo(() => {
    if (navigatorTabKey !== 'home' || selectedFilter !== 'Zote') return [];
    const hits = homeZotePool.filter(channelIsPopular);
    return hits.map((raw, i) => mapApiChannelToCard(raw, i, freeMode, serverHealth));
  }, [homeZotePool, navigatorTabKey, selectedFilter, freeMode, serverHealth]);

  const featuredChannelCards = useMemo(() => {
    if (navigatorTabKey !== 'home' || selectedFilter !== 'Zote') return [];
    const hits = homeZotePool.filter((r) => channelIsFeatured(r) && !channelIsPopular(r));
    return hits.map((raw, i) => mapApiChannelToCard(raw, i, freeMode, serverHealth));
  }, [homeZotePool, navigatorTabKey, selectedFilter, freeMode, serverHealth]);

  const displayChannels = useMemo(() => {
    if (maintenanceMode) return [];
    let rows = rawChannels.filter(channelVisibleInApp);
    rows = rows.filter((r) => channelAppearsOnNavigatorTab(r, navigatorTabKey));
    if (selectedFilter === 'Trending') {
      rows = rows.filter((r) => Boolean(r.isLive ?? r.live));
    } else if (selectedFilter === 'Sports' || selectedFilter === 'Tamthilia') {
      rows = rows.filter((r) => matchesHomePillFilter(r, selectedFilter));
    }
    if (
      navigatorTabKey === 'home' &&
      (selectedFilter === 'Zote' || selectedFilter === 'Trending')
    ) {
      rows = [...rows].sort(compareHomeMixChannels);
    }
    return rows.map((raw, i) => mapApiChannelToCard(raw, i, freeMode, serverHealth));
  }, [
    rawChannels,
    navigatorTabKey,
    selectedFilter,
    freeMode,
    serverHealth,
    maintenanceMode,
  ]);

  const bannerSlides = useMemo(() => {
    if (!Array.isArray(rawBanners)) return [];
    return rawBanners
      .map((b, i) => normalizeBanner(b, i))
      .filter((s) => isBannerVisibleAt(s, bannerVisibilityClock));
  }, [rawBanners, bannerVisibilityClock]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh({ showGlobalLoading: false });
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    setSelectedFilter('Zote');
    setRefreshKey((k) => k + 1);
    refresh({ showGlobalLoading: false });
  }, [refresh]);

  const onBannerEmergency = useCallback(() => {
    requestEmergencyModal();
  }, [requestEmergencyModal]);

  const onBannerPremiumRequired = useCallback(() => {
    setPremiumModalVisible(true);
  }, []);

  const handleCardPress = useCallback(
    async (item) => {
      const locked = !freeMode && item.isPremium && !isSubscribed;
      if (maintenanceMode) return;
      if (emergencyMode) {
        requestEmergencyModal();
        return;
      }
      if (locked) {
        setPremiumModalVisible(true);
        return;
      }
      if (item.isPremium && !freeMode) {
        const ok = await verifySubscriptionBeforePlay();
        if (!ok) {
          Alert.alert(
            'Kifurushi',
            'Hakuna malipo halali au kifurushi kimekwisha. Lipa ili kuendelea.',
          );
          setPremiumModalVisible(true);
          return;
        }
      }
      navigation.navigate('ChannelPlayer', {
        channel: item.playerChannel,
      });
    },
    [
      freeMode,
      isSubscribed,
      maintenanceMode,
      emergencyMode,
      verifySubscriptionBeforePlay,
      navigation,
      requestEmergencyModal,
    ],
  );

  const renderCard = ({ item }) => {
    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          void handleCardPress(item);
        }}
      >
        <View style={styles.cardImageWrap}>
          {item.thumbnailUri ? (
            <ExpoImage
              source={{ uri: item.thumbnailUri }}
              style={styles.cardImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Text style={styles.cardImagePlaceholderText}>{item.placeholderLetter}</Text>
            </View>
          )}
          <View style={styles.cardBadgesRow} pointerEvents="none">
            <View style={styles.cardBadgesLeft}>
              {item.showHD ? (
                <View style={styles.hdBadge}>
                  <Text style={styles.hdBadgeText}>HD</Text>
                </View>
              ) : null}
              <View style={[styles.statusPill, { backgroundColor: item.livePillColor }]}>
                <Text style={styles.liveBadgeText}>{item.liveLabel}</Text>
              </View>
            </View>
            <View style={[styles.statusPill, { backgroundColor: item.accessBadgeColor }]}>
              <Text
                style={[
                  styles.liveBadgeText,
                  item.accessBadge === 'KULIPIA' ? styles.liveBadgeTextOnYellow : null,
                ]}
              >
                {item.accessBadge}
              </Text>
            </View>
          </View>
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
            start={{ x: 0.5, y: 0.35 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.cardGradient}
          />
          <View style={styles.cardTitleOverlayWrap} pointerEvents="none">
            <View style={styles.cardChannelTitlePill}>
              <Text style={styles.cardChannelTitleText} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderHighlightCard = useCallback(
    (item) => (
      <Pressable
        style={styles.highlightCard}
        onPress={() => {
          void handleCardPress(item);
        }}
      >
        <View style={styles.highlightImageWrap}>
          {item.thumbnailUri ? (
            <ExpoImage
              source={{ uri: item.thumbnailUri }}
              style={styles.cardImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Text style={styles.cardImagePlaceholderText}>{item.placeholderLetter}</Text>
            </View>
          )}
          <View style={styles.cardBadgesRow} pointerEvents="none">
            <View style={styles.cardBadgesLeft}>
              {item.showHD ? (
                <View style={styles.hdBadge}>
                  <Text style={styles.hdBadgeText}>HD</Text>
                </View>
              ) : null}
              <View style={[styles.statusPill, { backgroundColor: item.livePillColor }]}>
                <Text style={styles.liveBadgeText}>{item.liveLabel}</Text>
              </View>
            </View>
            <View style={[styles.statusPill, { backgroundColor: item.accessBadgeColor }]}>
              <Text
                style={[
                  styles.liveBadgeText,
                  item.accessBadge === 'KULIPIA' ? styles.liveBadgeTextOnYellow : null,
                ]}
              >
                {item.accessBadge}
              </Text>
            </View>
          </View>
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
            start={{ x: 0.5, y: 0.35 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.cardGradient}
          />
          <View style={styles.cardTitleOverlayWrap} pointerEvents="none">
            <View style={styles.cardChannelTitlePill}>
              <Text style={styles.cardChannelTitleText} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    ),
    [handleCardPress],
  );

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.topRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleLine}>
              <OtaDebugTitleTap>
                <Text style={styles.appTitle}>Osmani TV</Text>
              </OtaDebugTitleTap>
              <Ionicons name="search" size={22} color={COLORS.white} />
            </View>
            <Text style={styles.subtitle}>Tazama Live Kila Mahali</Text>
          </View>
          <View style={styles.topButtons}>
            <Pressable
              style={[styles.topButton, styles.topButtonWithIcon, { backgroundColor: COLORS.yellow }]}
              onPress={handleRefresh}
            >
              <Ionicons name="refresh" size={17} color="#000000" />
              <Text style={styles.topButtonText}>Refresh</Text>
            </Pressable>
          </View>
        </View>

        {loading && bannerSlides.length === 0 ? (
          <BannerCarouselSkeleton slideWidth={CAROUSEL_SLIDE_WIDTH} />
        ) : bannerSlides.length > 0 ? (
          <BannerCarousel
            resetKey={refreshKey}
            slides={bannerSlides}
            slideWidth={CAROUSEL_SLIDE_WIDTH}
            rawChannels={rawChannels}
            freeMode={freeMode}
            isSubscribed={isSubscribed}
            maintenanceMode={maintenanceMode}
            emergencyMode={emergencyMode}
            navigation={navigation}
            onEmergency={onBannerEmergency}
            onPremiumRequired={onBannerPremiumRequired}
            verifySubscriptionBeforePlay={verifySubscriptionBeforePlay}
          />
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map((filter) => {
            const isSelected = selectedFilter === filter;
            return (
              <Pressable
                key={filter}
                onPress={() => setSelectedFilter(filter)}
                style={[
                  styles.filterPill,
                  { backgroundColor: isSelected ? COLORS.filterSelected : COLORS.filterPill },
                ]}
              >
                <Text style={styles.filterText}>{filter}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.channelsStatusRow}>
            <ActivityIndicator color={COLORS.greenButton} />
            <Text style={styles.channelsStatusText}>Inapakia chaneli…</Text>
          </View>
        ) : null}
        {error && !loading ? <Text style={styles.channelsErrorText}>{error}</Text> : null}

        {!maintenanceMode &&
        navigatorTabKey === 'home' &&
        selectedFilter === 'Zote' &&
        popularChannelCards.length > 0 ? (
          <View style={styles.highlightSection}>
            <Text style={styles.highlightSectionTitle}>Maarufu</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.highlightRow}
            >
              {popularChannelCards.map((item) => (
                <View key={`pop-${item.id}`} style={styles.highlightCardWrap}>
                  {renderHighlightCard(item)}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {!maintenanceMode &&
        navigatorTabKey === 'home' &&
        selectedFilter === 'Zote' &&
        featuredChannelCards.length > 0 ? (
          <View style={styles.highlightSection}>
            <Text style={styles.highlightSectionTitle}>Vipengele</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.highlightRow}
            >
              {featuredChannelCards.map((item) => (
                <View key={`feat-${item.id}`} style={styles.highlightCardWrap}>
                  {renderHighlightCard(item)}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {!maintenanceMode ? (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {catalogGridSectionTitle(navigatorTabKey, selectedFilter)}
            </Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{displayChannels.length}</Text>
            </View>
          </View>
        ) : null}
      </View>
    ),
    [
      selectedFilter,
      navigatorTabKey,
      popularChannelCards,
      featuredChannelCards,
      handleRefresh,
      displayChannels.length,
      bannerSlides,
      loading,
      error,
      refreshKey,
      rawChannels,
      freeMode,
      isSubscribed,
      subscriptionVersion,
      maintenanceMode,
      emergencyMode,
      navigation,
      onBannerEmergency,
      onBannerPremiumRequired,
      verifySubscriptionBeforePlay,
      handleCardPress,
      renderHighlightCard,
    ]
  );

  const catalogListEmpty = useMemo(() => {
    if (loading) return null;
    if (maintenanceMode) {
      return (
        <View style={styles.maintenanceChannelArea}>
          <MaintenanceHomeCentered />
        </View>
      );
    }
    return <Text style={styles.channelsEmptyText}>Hakuna chaneli bado.</Text>;
  }, [loading, maintenanceMode]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={['top']}>
      <StatusBar style="light" />
      <FlatList
        key={String(refreshKey)}
        data={displayChannels}
        extraData={{ isSubscribed, subscriptionVersion, maintenanceMode }}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={catalogListEmpty}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: listBottomPadding },
          !loading && maintenanceMode && displayChannels.length === 0 ? { flexGrow: 1 } : null,
        ]}
        columnWrapperStyle={displayChannels.length > 0 ? styles.gridRow : null}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={COLORS.greenButton}
            colors={[COLORS.greenButton]}
          />
        }
      />
      <PremiumModal
        visible={premiumModalVisible}
        onClose={() => setPremiumModalVisible(false)}
        onUnlockSuccess={() => {
          navigation.navigate('Home');
        }}
      />
      {mountManualGiftModal ? (
        <ManualSubscriptionGiftModal
          visible
          busy={manualGiftAckBusy}
          onAcknowledge={acknowledgeManualGiftPress}
        />
      ) : null}
      {mountReminderModal ? (
        <SubscriptionExpiryReminderModal
          visible
          displayDays={expiryReminderDisplayDays}
          onRenew={onRenewFromExpiryReminder}
          onDismissLater={dismissExpiryReminder}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Emergency modal is global so ChannelPlayer can return to tabs and the user still sees the alert.
 * Re-opens when admin toggles emergency on or user taps emergency banner/channel.
 */
function GlobalEmergencyGate() {
  const { emergencyMode, emergencyModalRequestVersion } = useOsmaniApp();
  const [dismissed, setDismissed] = useState(false);
  const prevEmergencyRef = useRef(false);

  useEffect(() => {
    const was = prevEmergencyRef.current;
    if (emergencyMode && !was) setDismissed(false);
    if (!emergencyMode) setDismissed(false);
    prevEmergencyRef.current = emergencyMode;
  }, [emergencyMode]);

  useEffect(() => {
    if (emergencyModalRequestVersion > 0) setDismissed(false);
  }, [emergencyModalRequestVersion]);

  const visible = Boolean(emergencyMode) && !dismissed;
  useRegisterBlockingSheet('global-emergency', visible);

  return <EmergencyModal visible={visible} onSawa={() => setDismissed(true)} />;
}

function PlaceholderScreen({ title }) {
  const insets = useSafeAreaInsets();
  const bottomPad = getScrollContentBottomPadding(insets);
  return (
    <SafeAreaView
      style={[styles.placeholderScreen, { paddingBottom: bottomPad }]}
      edges={['top']}
    >
      <StatusBar style="light" />
      <Text style={styles.placeholderText}>{title} Screen</Text>
    </SafeAreaView>
  );
}

/** Lovable-style bar: full-width bottom, blur + rgba(10,10,10,0.95), safe-area inset inside. */
function OsmaniLovableTabBar(props) {
  const insets = useSafeAreaInsets();
  const totalHeight = getTabBarTotalHeight(insets);
  const blurIntensity = Platform.OS === 'ios' ? 88 : Platform.OS === 'android' ? 50 : 0;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: totalHeight,
        overflow: 'visible',
      }}
    >
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0C0608' }]} />
      ) : (
        <>
          <BlurView
            intensity={blurIntensity}
            tint="dark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(12, 6, 8, 0.96)' }]}
          />
        </>
      )}
      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: 'rgba(255,255,255,0.08)',
          height: totalHeight,
          overflow: 'visible',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.42,
          shadowRadius: 18,
          elevation: 32,
        }}
      >
        {/* Shift tab row up for optical vertical balance (bar height + bottom inset unchanged). */}
        <View
          style={{
            flex: 1,
            transform: [
              {
                translateY:
                  Platform.OS === 'ios' ? -4 : Platform.OS === 'android' ? -5 : -3,
              },
            ],
          }}
        >
          <BottomTabBar
            {...props}
            insets={{ top: 0, left: insets.left, right: insets.right, bottom: insets.bottom }}
            style={{
              backgroundColor: Platform.OS === 'web' ? '#0C0608' : 'transparent',
              borderTopWidth: 0,
              elevation: 0,
              height: totalHeight,
              paddingTop: Platform.OS === 'ios' ? 8 : 7,
              paddingBottom: insets.bottom,
              paddingHorizontal: 6,
              justifyContent: 'flex-start',
            }}
          />
        </View>
      </View>
    </View>
  );
}

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={AppTabs} />
      <Stack.Screen
        name="ChannelPlayer"
        component={ChannelPlayerScreen}
        options={{
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}

function AppTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <OsmaniLovableTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: COLORS.background },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIcon: ({ color, focused }) => {
          const iconMap = {
            Home: 'home',
            Sports: 'football',
            Tamthilia: 'film',
            'Akaunti Yangu': 'person-circle',
          };
          const iconName = iconMap[route.name];
          const iconSize = focused ? 27 : 24;
          const icon = (
            <Ionicons name={iconName} size={iconSize} color={color} />
          );
          if (!focused) return icon;
          return (
            <View
              style={{
                shadowColor: '#FF8C00',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.95,
                shadowRadius: 10,
                elevation: 12,
              }}
            >
              {icon}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home">
        {(props) => (
          <ChannelCatalogScreen {...props} navigatorTabKey="home" enableHomeExpiryReminder />
        )}
      </Tab.Screen>
      <Tab.Screen name="Sports">
        {(props) => <ChannelCatalogScreen {...props} navigatorTabKey="sports" />}
      </Tab.Screen>
      <Tab.Screen name="Tamthilia">
        {(props) => <ChannelCatalogScreen {...props} navigatorTabKey="tamthilia" />}
      </Tab.Screen>
      <Tab.Screen name="Akaunti Yangu" component={AkauntiYanguScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [navigationRevision, setNavigationRevision] = useState(0);

  useLayoutEffect(() => {
    openOsmaniUrlRef.current = (url) => {
      const tab = resolveMainTabFromOsmaniUrl(url);
      if (!tab) return;
      if (navigationRef.isReady()) {
        pendingOsmaniUrlRef.current = null;
        navigationRef.navigate('MainTabs', { screen: tab });
      } else {
        pendingOsmaniUrlRef.current = url;
      }
    };
  });

  useEffect(() => {
    void trackInstallOnce();
    void startPresence();
    startRealtimeSync();
    startUpdateClient();
    const stopOneSignal = setupOneSignal({
      onOpenUrl: (url) => {
        openOsmaniUrlRef.current(url);
      },
    });
    return () => {
      void stopPresence();
      stopRealtimeSync();
      stopUpdateClient();
      try {
        stopOneSignal();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <SafeAreaProvider>
      <OsmaniAppProvider>
        <ModalSheetCoordinatorProvider>
          <NavigationContainer
            ref={navigationRef}
            linking={osmaniLinking}
            theme={{
              ...DarkTheme,
              colors: {
                ...DarkTheme.colors,
                background: COLORS.background,
                card: COLORS.card,
                border: 'rgba(255,255,255,0.06)',
              },
            }}
            onReady={() => {
              setNavigationRevision((n) => n + 1);
              const pending = pendingOsmaniUrlRef.current;
              if (pending) {
                pendingOsmaniUrlRef.current = null;
                openOsmaniUrlRef.current(pending);
              }
            }}
            onStateChange={() => setNavigationRevision((n) => n + 1)}
          >
            <RootNavigator />
          </NavigationContainer>
          <GlobalEmergencyGate />
          <WhatsAppFloatingButtonGate
            navigationRef={navigationRef}
            navigationRevision={navigationRevision}
          />
          <PopupSettingsModal />
          <UpdateOverlay />
          <OtaDebugOverlay />
          <SubscriptionLifecycleGates />
        </ModalSheetCoordinatorProvider>
      </OsmaniAppProvider>
    </SafeAreaProvider>
  );
}

/**
 * Mounts the two global subscription-lifecycle modals so they are always
 * available regardless of which screen the user is on.
 *   - TransferConfirmModal:    shown on the SOURCE device when the
 *     backend pushes `transfer_requested` over /api/sync/stream.
 *   - TransferredAwayModal:    hard-block shown after `subscription_revoked`,
 *     `transfer_completed` (when the backend confirms this device lost
 *     access), or any pre-play verify that returns active=false.
 */
function SubscriptionLifecycleGates() {
  const {
    revokedReason,
    dismissRevoked,
    pendingTransfer,
    dismissPendingTransfer,
    reverifySubscription,
  } = useOsmaniApp();
  const [recovering, setRecovering] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);

  useRegisterBlockingSheet('lifecycle-plans', plansOpen);
  useRegisterBlockingSheet('lifecycle-transfer', Boolean(pendingTransfer));
  useRegisterBlockingSheet(
    'lifecycle-revoked',
    Boolean(revokedReason) && !plansOpen,
  );

  const onRecover = useCallback(async () => {
    if (recovering) return;
    setRecovering(true);
    try {
      const r = await reverifySubscription('user-recover');
      if (r?.active === true) {
        dismissRevoked();
      }
    } finally {
      setRecovering(false);
    }
  }, [dismissRevoked, recovering, reverifySubscription]);

  const onOpenPlans = useCallback(() => {
    setPlansOpen(true);
    dismissRevoked();
  }, [dismissRevoked]);

  const onPlansClose = useCallback(() => {
    setPlansOpen(false);
  }, []);

  const onPlansUnlock = useCallback(() => {
    setPlansOpen(false);
    void reverifySubscription('plan-unlock');
  }, [reverifySubscription]);

  return (
    <>
      {pendingTransfer ? (
        <TransferConfirmModal event={pendingTransfer} onDismiss={dismissPendingTransfer} />
      ) : null}
      <TransferredAwayModal
        visible={Boolean(revokedReason) && !plansOpen}
        reason={revokedReason ?? 'transferred'}
        recovering={recovering}
        onRecover={onRecover}
        onOpenPlans={onOpenPlans}
      />
      <PremiumModal visible={plansOpen} onClose={onPlansClose} onUnlockSuccess={onPlansUnlock} />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleWrap: {
    flex: 1,
    marginRight: 8,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  appTitle: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    color: COLORS.mutedText,
    fontSize: 14,
  },
  topButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  topButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topButtonWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topButtonText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 13,
  },
  filterRow: {
    marginTop: 12,
    paddingRight: 16,
    gap: 10,
  },
  filterPill: {
    borderRadius: 50,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  filterText: {
    color: COLORS.white,
    fontWeight: '500',
    fontSize: 14,
  },
  sectionHeader: {
    marginTop: 12,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
  },
  highlightSection: {
    marginTop: 16,
  },
  highlightSectionTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingRight: HORIZONTAL_PADDING,
    gap: 10,
  },
  highlightCardWrap: {
    marginRight: 2,
  },
  highlightCard: {
    width: HIGHLIGHT_CARD_WIDTH,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  highlightImageWrap: {
    width: HIGHLIGHT_CARD_WIDTH,
    height: HIGHLIGHT_CARD_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#283246',
  },
  countBadge: {
    marginLeft: 8,
    backgroundColor: '#334057',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  countBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  channelsStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 2,
  },
  channelsStatusText: {
    color: COLORS.mutedText,
    fontSize: 14,
  },
  channelsErrorText: {
    color: '#FF8A80',
    fontSize: 14,
    marginTop: 12,
    paddingHorizontal: 2,
  },
  /** Fills channel region below header when grid is hidden (maintenance). */
  maintenanceChannelArea: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 360,
    paddingHorizontal: 0,
  },
  channelsEmptyText: {
    color: COLORS.mutedText,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  gridRow: {
    justifyContent: 'space-between',
    marginTop: 10,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardImageWrap: {
    width: '100%',
    height: CARD_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#283246',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    backgroundColor: '#283246',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePlaceholderText: {
    fontSize: 40,
    fontWeight: '800',
    color: COLORS.mutedText,
  },
  cardBadgesRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 3,
  },
  hdBadgePlaceholder: {
    minWidth: 0,
  },
  hdBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  hdBadgeText: {
    color: '#E5E7EB',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardBadgesRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardBadgesLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
  },
  liveBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  liveBadgeTextOnYellow: {
    color: '#111827',
  },
  cardTitleOverlayWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    zIndex: 4,
  },
  cardChannelTitlePill: {
    alignSelf: 'center',
    backgroundColor: '#facc15',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    maxWidth: '92%',
  },
  cardChannelTitleText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  tabBarItem: {
    paddingTop: 0,
    paddingBottom: 0,
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.12,
    marginBottom: 0,
    marginTop: 0,
  },
  placeholderScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '500',
  },
});
