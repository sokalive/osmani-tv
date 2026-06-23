import 'react-native-gesture-handler';
import './lib/startupSplashBoot';
import './lib/oneSignalBoot';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import DeviceIntelligenceGate from './components/DeviceIntelligenceGate';
import PremiumModal from './components/PremiumModal';
import HomeExpiryFloatingBanner from './components/HomeExpiryFloatingBanner';
import NotificationPermissionReminderGate from './components/NotificationPermissionReminderGate';
import ManualSubscriptionGiftModal from './components/ManualSubscriptionGiftModal';
import PopupSettingsModal from './components/PopupSettingsModal';
import TransferConfirmModal from './components/TransferConfirmModal';
import TransferSuccessModal from './components/TransferSuccessModal';
import TransferredAwayModal from './components/TransferredAwayModal';
import UpdateOverlay from './components/UpdateOverlay';
import ChannelUpdateGateModal from './components/ChannelUpdateGateModal';
import OtaDebugOverlay, { OtaDebugTitleTap } from './components/OtaDebugOverlay';
import WhatsAppFloatingButtonGate from './components/WhatsAppFloatingButtonGate';
import GlobalPaymentModalGate from './components/GlobalPaymentModalGate';
import AkauntiYanguScreen from './screens/AkauntiYanguScreen';
import ChannelPlayerScreen from './screens/ChannelPlayerScreen';
import { OsmaniAppProvider, useOsmaniApp } from './context/OsmaniAppContext';
import { DeviceIntelligenceProvider, useDeviceIntelligence } from './context/DeviceIntelligenceContext';
import { SecurityProvider, useSecurity } from './context/SecurityContext';
import {
  ModalSheetCoordinatorProvider,
  useModalSheetCoordinator,
  useRegisterBlockingSheet,
} from './context/ModalSheetCoordinatorContext';
import { optimizeDisplayImageUrl, resolveMediaAssetUrl } from './lib/mediaDelivery';
import { isCatalogInteractionBlocked } from './lib/catalogConnectivity';
import { acknowledgeManualGift } from './api/subscription';
import { trackInstallOnce } from './api/analytics';
import { startPresence, stopPresence } from './lib/presenceTracker';
import { startRealtimeSync, stopRealtimeSync } from './lib/realtimeSync';
import { startExpoUpdatesClient } from './lib/expoUpdatesClient';
import { startUpdateClient, stopUpdateClient } from './lib/updateClient';
import { setupOneSignal } from './lib/oneSignal';
import { dispatchOsmaniDeepLink } from './lib/osmaniDeepLinkDispatch';
import OsmaniDeepLinkGate from './components/OsmaniDeepLinkGate';
import { resolveStream } from './lib/channelStream';
import { getScrollContentBottomPadding, getTabBarTotalHeight } from './lib/tabBarLayout';
import { isBannerVisibleAt, normalizeBanner } from './lib/normalizeBanner';
import { buildPlayerChannelFromRow } from './lib/playerChannelFromRow';
import { openPremiumChannelFromSnapshot } from './lib/premiumChannelNavigation';
import { logChannelCardTap } from './lib/channelCardTapDiagnostics';
import { channelIsFreeAccess } from './lib/trialWatchAccess';
import { computeNearExpirySnapshot } from './lib/subscriptionNearExpiry';
import { getDeviceIdentity } from './lib/deviceIdentity';
import { useGlobalSecureScreen } from './lib/security/useGlobalSecureScreen';
import { useStartupSplash } from './hooks/useStartupSplash';
import EmbeddedOtaBootGate from './components/EmbeddedOtaBootGate';
import { logFirstLaunchBootDiagnostics } from './lib/firstLaunchBootDiagnostics';
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
  getChannelTabKeys,
  matchesHomePillFilter,
} from './lib/channelTabVisibility';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Single ref for WhatsApp FAB visibility (must not use hooks outside a navigator). */
const navigationRef = createNavigationContainerRef();

/** Cold start: deep link may arrive before NavigationContainer is ready — flush in onReady. */
const pendingOsmaniUrlRef = { current: /** @type {string | null} */ (null) };

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
      /** Channel opens are handled in OsmaniDeepLinkGate (catalog + subscription gate). */
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
  let resolved = null;
  if (abs.startsWith('http')) resolved = resolveMediaAssetUrl(abs);
  else if (rel.startsWith('http')) resolved = resolveMediaAssetUrl(rel);
  else if (rel.startsWith('/')) resolved = resolveMediaAssetUrl(rel);
  else if (rel.length > 0) resolved = resolveMediaAssetUrl(rel);
  if (!resolved) return null;
  return optimizeDisplayImageUrl(resolved, { maxWidth: 360, quality: 80 });
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

/** Home floating banner: hidden gap then visible window (repeats). */
const HOME_EXPIRY_FLOATER_GAP_MS = 5 * 60 * 1000;
const HOME_EXPIRY_FLOATER_SHOW_MS = 3 * 60 * 1000;

const REMINDER_DEBUG_PREFIX = '[REMINDER_COORD]';
function reminderCoordLog(...args) {
  if (__DEV__) console.log(REMINDER_DEBUG_PREFIX, ...args);
}

function ChannelCatalogScreen({
  navigation,
  route,
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
    isOffline,
    refresh,
    isSubscribed,
    subscriptionExpiresAt,
    subscriptionDetails,
    subscriptionVersion,
    verifySubscriptionBeforePlay,
    requestEmergencyModal,
    trialWatchSettings,
    awaitPremiumAccessSnapshot,
    awaitRecoverBoot,
    getPremiumAccessSnapshot,
    subscriptionSyncLoaded,
    trialWatchSettingsLoaded,
    requireUpdateBeforeChannelPlayback,
    requestChannelUpdateGate,
  } = useOsmaniApp();
  const security = useSecurity();
  const { guardUsage: guardDeviceIntelligence } = useDeviceIntelligence();
  const [selectedFilter, setSelectedFilter] = useState('Zote');
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [homeFloaterVisible, setHomeFloaterVisible] = useState(false);
  const [manualGiftVisible, setManualGiftVisible] = useState(false);
  const [offlineModalVisible, setOfflineModalVisible] = useState(false);
  const [manualGiftAckBusy, setManualGiftAckBusy] = useState(false);
  const [manualGiftAckLoaded, setManualGiftAckLoaded] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bannerVisibilityClock, setBannerVisibilityClock] = useState(() => Date.now());
  const wasOfflineRef = useRef(false);

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
  const freeModeRef = useRef(freeMode);
  const homeFloaterPhaseRef = useRef(/** @type {'gap'|'show'} */ ('gap'));
  const homeFloaterDeadlineRef = useRef(0);
  const homeFloaterBootRef = useRef(false);
  const deferredManualGiftRef = useRef(false);
  const tryShowManualGiftRef = useRef(async () => false);
  const manualGiftVisibleRef = useRef(false);
  isSubscribedRef.current = isSubscribed;
  subscriptionDetailsRef.current = subscriptionDetails;
  subscriptionExpiresAtRef.current = subscriptionExpiresAt;
  freeModeRef.current = freeMode;

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
    if (!enableHomeExpiryReminder) return;
    if (route?.params?.openPremiumAfterExpiry === true) {
      void (async () => {
        if (guardDeviceIntelligence().ok === false) return;
        await awaitPremiumAccessSnapshot?.();
        setPremiumModalVisible(true);
      })();
      navigation.setParams({ openPremiumAfterExpiry: false });
    }
  }, [
    enableHomeExpiryReminder,
    navigation,
    route?.params?.openPremiumAfterExpiry,
    awaitPremiumAccessSnapshot,
    guardDeviceIntelligence,
  ]);

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
    /* keeps manual-gift ack keys in sync before popup decisions */
    await Promise.all([readManualGiftAck(), readPendingManualGiftKey()]).catch(() => {});
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
    if (!enableHomeExpiryReminder || navigatorTabKey !== 'home') {
      setHomeFloaterVisible(false);
      homeFloaterBootRef.current = false;
      return undefined;
    }
    const id = setInterval(() => {
      const snap = computeNearExpirySnapshot({
        isSubscribed,
        freeMode,
        subscriptionDetails,
        subscriptionExpiresAt,
      });
      if (!snap.eligible) {
        setHomeFloaterVisible(false);
        homeFloaterBootRef.current = false;
        return;
      }
      const now = Date.now();
      if (!homeFloaterBootRef.current) {
        homeFloaterBootRef.current = true;
        homeFloaterPhaseRef.current = 'gap';
        homeFloaterDeadlineRef.current = now + HOME_EXPIRY_FLOATER_GAP_MS;
        setHomeFloaterVisible(false);
        return;
      }
      if (now >= homeFloaterDeadlineRef.current) {
        if (homeFloaterPhaseRef.current === 'gap') {
          homeFloaterPhaseRef.current = 'show';
          homeFloaterDeadlineRef.current = now + HOME_EXPIRY_FLOATER_SHOW_MS;
          setHomeFloaterVisible(true);
        } else {
          homeFloaterPhaseRef.current = 'gap';
          homeFloaterDeadlineRef.current = now + HOME_EXPIRY_FLOATER_GAP_MS;
          setHomeFloaterVisible(false);
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [
    enableHomeExpiryReminder,
    navigatorTabKey,
    isSubscribed,
    freeMode,
    subscriptionDetails,
    subscriptionExpiresAt,
    subscriptionVersion,
  ]);

  const homeNearExpirySnap = useMemo(
    () =>
      computeNearExpirySnapshot({
        isSubscribed,
        freeMode,
        subscriptionDetails,
        subscriptionExpiresAt,
      }),
    [isSubscribed, freeMode, subscriptionDetails, subscriptionExpiresAt, subscriptionVersion],
  );

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
      manualGiftVisibleRef.current = false;
      setManualGiftVisible(false);
      console.log('[MANUAL_GIFT]', 'ack_complete', { key });
      void syncPendingGiftBlocking();
    } catch (e) {
      Alert.alert(
        'Hitilafu',
        typeof e?.message === 'string' ? e.message : 'Huwezi kuthibitisha sasa. Jaribu tena.',
      );
    } finally {
      setManualGiftAckBusy(false);
    }
  }, [syncPendingGiftBlocking]);

  const openPremiumModal = useCallback(() => {
    if (guardDeviceIntelligence().ok === false) return;
    setPremiumModalVisible(true);
  }, [guardDeviceIntelligence]);

  const mountManualGiftModal = enableHomeExpiryReminder && manualGiftVisible;

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
    return rows.map((raw, i) => mapApiChannelToCard(raw, i, freeMode, serverHealth));
  }, [
    rawChannels,
    navigatorTabKey,
    selectedFilter,
    freeMode,
    serverHealth,
    maintenanceMode,
  ]);

  /** Spinner only while the first channel catalog fetch is pending (not during background refresh). */
  const channelsPendingInitialLoad = loading && rawChannels.length === 0;

  /** Offline UX only when there is no usable catalog — not on background refresh failures. */
  const catalogBlocked = useMemo(
    () => isCatalogInteractionBlocked(isOffline, displayChannels.length),
    [isOffline, displayChannels.length],
  );

  const bannerSlides = useMemo(() => {
    if (!Array.isArray(rawBanners)) return [];
    return rawBanners
      .map((b, i) => normalizeBanner(b, i))
      .filter((s) => isBannerVisibleAt(s, bannerVisibilityClock));
  }, [rawBanners, bannerVisibilityClock]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh({ showGlobalLoading: false, forceNetwork: true, preserveDataOnError: true });
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    setSelectedFilter('Zote');
    setRefreshKey((k) => k + 1);
    refresh({ showGlobalLoading: false, forceNetwork: true, preserveDataOnError: true });
  }, [refresh]);

  const onBannerEmergency = useCallback(() => {
    requestEmergencyModal();
  }, [requestEmergencyModal]);

  const navigateToChannel = useCallback(
    async (playerChannel, { isPremium = false } = {}) => {
      const channelKey = String(
        playerChannel?.id ?? playerChannel?.channel_id ?? playerChannel?.name ?? '',
      ).trim();
      const startedAt = Date.now();
      logChannelCardTap('navigation_start', {
        channelKey,
        isPremium,
        premiumPlaybackReady,
        subscriptionSyncLoaded,
        trialWatchSettingsLoaded,
      });
      if (!playerChannel) {
        logChannelCardTap('navigation_blocked', { channelKey, reason: 'missing_channel' });
        return;
      }
      const isFree = freeMode || channelIsFreeAccess(playerChannel, { freeMode });
      const isPremiumChannel = isPremium && !isFree && !freeMode;
      if (isPremiumChannel && !isSubscribed) {
        await awaitRecoverBoot();
      }
      const snapshot = getPremiumAccessSnapshot();
      logChannelCardTap('snapshot_immediate', {
        channelKey,
        isFree,
        isPremiumChannel,
        isSubscribed: snapshot.isSubscribed,
        waitedMs: Date.now() - startedAt,
      });
      await openPremiumChannelFromSnapshot(snapshot, {
        playerChannel,
        cardIsPremium: isPremium,
        navigation,
        openPaymentModal: openPremiumModal,
        verifySubscriptionBeforePlay,
        security,
        Alert,
        requireUpdateBeforeChannelPlayback,
        onChannelUpdateRequired: requestChannelUpdateGate,
      });
      logChannelCardTap('navigation_finished', {
        channelKey,
        totalMs: Date.now() - startedAt,
      });
    },
    [
      awaitRecoverBoot,
      verifySubscriptionBeforePlay,
      navigation,
      security,
      openPremiumModal,
      freeMode,
      premiumPlaybackReady,
      getPremiumAccessSnapshot,
      subscriptionSyncLoaded,
      trialWatchSettingsLoaded,
      isSubscribed,
      requireUpdateBeforeChannelPlayback,
      requestChannelUpdateGate,
    ],
  );

  const onBannerPremiumRequired = useCallback(() => {
    openPremiumModal();
  }, [openPremiumModal]);

  const handleCardPress = useCallback(
    async (item) => {
      const channelKey = String(item?.id ?? item?.title ?? '').trim();
      logChannelCardTap('tap_received', {
        channelKey,
        isPremium: item?.isPremium,
        loading,
        premiumPlaybackReady,
        subscriptionSyncLoaded,
        trialWatchSettingsLoaded,
        maintenanceMode,
        emergencyMode,
        isOffline,
      });
      if (guardDeviceIntelligence().ok === false) {
        logChannelCardTap('tap_cancelled', { channelKey, reason: 'device_intelligence' });
        return;
      }
      if (catalogBlocked) {
        logChannelCardTap('tap_cancelled', { channelKey, reason: 'offline' });
        setOfflineModalVisible(true);
        return;
      }
      if (maintenanceMode) {
        logChannelCardTap('tap_cancelled', { channelKey, reason: 'maintenance' });
        return;
      }
      if (emergencyMode) {
        logChannelCardTap('tap_cancelled', { channelKey, reason: 'emergency' });
        requestEmergencyModal();
        return;
      }
      await navigateToChannel(item.playerChannel, { isPremium: item.isPremium });
    },
    [
      maintenanceMode,
      emergencyMode,
      navigateToChannel,
      requestEmergencyModal,
      premiumPlaybackReady,
      subscriptionSyncLoaded,
      trialWatchSettingsLoaded,
      loading,
      catalogBlocked,
      guardDeviceIntelligence,
    ],
  );

  useEffect(() => {
    if (catalogBlocked) {
      wasOfflineRef.current = true;
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      void refresh({ showGlobalLoading: false, preserveDataOnError: true });
    }
  }, [catalogBlocked, refresh]);

  const renderCard = useCallback(
    ({ item }) => (
      <Pressable
        style={styles.card}
        delayPressIn={0}
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
    ),
    [handleCardPress],
  );

  const renderHighlightCard = useCallback(
    (item) => (
      <Pressable
        style={styles.highlightCard}
        delayPressIn={0}
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
            getPremiumAccessSnapshot={getPremiumAccessSnapshot}
            awaitRecoverBoot={awaitRecoverBoot}
            openPaymentModal={openPremiumModal}
            requireUpdateBeforeChannelPlayback={requireUpdateBeforeChannelPlayback}
            onChannelUpdateRequired={requestChannelUpdateGate}
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

        {channelsPendingInitialLoad ? (
          <View style={styles.channelsStatusRow}>
            <ActivityIndicator color={COLORS.greenButton} />
            <Text style={styles.channelsStatusText}>Inapakia chaneli…</Text>
          </View>
        ) : null}
        {catalogBlocked ? (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#FBBF24" />
            <Text style={styles.offlineBannerText}>
              Tafadhali hakikisha una kifurushi cha intaneti kinachofanya kazi. Angalia salio la kifurushi chako kisha ujaribu tena.
            </Text>
          </View>
        ) : null}
        {error && !channelsPendingInitialLoad && !catalogBlocked ? (
          <Text style={styles.channelsErrorText}>{error}</Text>
        ) : null}

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
            {!catalogBlocked ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{displayChannels.length}</Text>
              </View>
            ) : null}
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
      channelsPendingInitialLoad,
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
    if (channelsPendingInitialLoad) return null;
    if (maintenanceMode) {
      return (
        <View style={styles.maintenanceChannelArea}>
          <MaintenanceHomeCentered />
        </View>
      );
    }
    if (catalogBlocked) {
      return <Text style={styles.channelsEmptyText}>Unganisha intaneti kuendelea kupata taarifa mpya.</Text>;
    }
    return <Text style={styles.channelsEmptyText}>Hakuna chaneli bado.</Text>;
  }, [channelsPendingInitialLoad, maintenanceMode, catalogBlocked]);

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
          !channelsPendingInitialLoad && maintenanceMode && displayChannels.length === 0
            ? { flexGrow: 1 }
            : null,
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
      {enableHomeExpiryReminder && navigatorTabKey === 'home' && homeNearExpirySnap.eligible ? (
        <HomeExpiryFloatingBanner
          visible={homeFloaterVisible}
          detailLine={`Bado siku ~${homeNearExpirySnap.displaySikuX} (saa ~${homeNearExpirySnap.remainingHoursCeil}).`}
          onPayPress={() => {
            void openPremiumModal();
          }}
        />
      ) : null}
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
      <EmergencyModal
        visible={offlineModalVisible}
        title="Muunganisho wa Intaneti Unahitajika"
        message="Tafadhali hakikisha una kifurushi cha intaneti kinachofanya kazi. Angalia salio la kifurushi chako au washa data/Wi-Fi kisha ujaribu tena."
        iconName="cloud-offline"
        primaryLabel="Jaribu Tena"
        secondaryLabel="Funga"
        onSawa={() => {
          if (catalogBlocked) {
            setOfflineModalVisible(false);
            return;
          }
          setOfflineModalVisible(false);
          setSelectedFilter('Zote');
          setRefreshKey((k) => k + 1);
          void refresh({ showGlobalLoading: false, forceNetwork: true, preserveDataOnError: true });
        }}
        onSecondary={() => setOfflineModalVisible(false)}
      />
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
          animation: Platform.OS === 'android' ? 'slide_from_right' : 'fade',
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

  return (
    <SafeAreaProvider style={styles.appRoot}>
      <StatusBar style="light" backgroundColor="#000000" />
      <EmbeddedOtaBootGate>
        <AppShell navigationRevision={navigationRevision} setNavigationRevision={setNavigationRevision} />
      </EmbeddedOtaBootGate>
    </SafeAreaProvider>
  );
}

function ChannelUpdateGateHost() {
  const { channelUpdateGateVisible, dismissChannelUpdateGate } = useOsmaniApp();
  return (
    <ChannelUpdateGateModal visible={channelUpdateGateVisible} onDismiss={dismissChannelUpdateGate} />
  );
}

function AppShell({ navigationRevision, setNavigationRevision }) {
  useStartupSplash();
  useGlobalSecureScreen();

  useEffect(() => {
    logFirstLaunchBootDiagnostics('app_boot_ready');
    void trackInstallOnce();
    void startPresence();
    startRealtimeSync();
    startUpdateClient();
    const stopExpoUpdates = startExpoUpdatesClient();
    const stopOneSignal = setupOneSignal({
      onOpenUrl: dispatchOsmaniDeepLink,
    });
    return () => {
      void stopPresence();
      stopRealtimeSync();
      stopUpdateClient();
      try {
        stopExpoUpdates();
      } catch {
        /* ignore */
      }
      try {
        stopOneSignal();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <OsmaniAppProvider>
        <DeviceIntelligenceProvider>
          <SecurityProvider>
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
                  dispatchOsmaniDeepLink(pending);
                }
              }}
              onStateChange={() => setNavigationRevision((n) => n + 1)}
            >
              <RootNavigator />
              <OsmaniDeepLinkGate
                navigationRef={navigationRef}
                pendingUrlRef={pendingOsmaniUrlRef}
              />
            </NavigationContainer>
            <GlobalEmergencyGate />
            <DeviceIntelligenceGate navigationRef={navigationRef} />
            <NotificationPermissionReminderGate />
            <WhatsAppFloatingButtonGate
              navigationRef={navigationRef}
              navigationRevision={navigationRevision}
            />
            <PopupSettingsModal />
            <UpdateOverlay />
            <ChannelUpdateGateHost />
            <OtaDebugOverlay />
            <SubscriptionLifecycleGates />
            <GlobalPaymentModalGate />
            </ModalSheetCoordinatorProvider>
          </SecurityProvider>
        </DeviceIntelligenceProvider>
      </OsmaniAppProvider>
  );
}

/**
 * Mounts the two global subscription-lifecycle modals so they are always
 * available regardless of which screen the user is on.
 *   - TransferConfirmModal:    shown on the SOURCE device when the
 *     backend pushes `transfer_requested` over /api/sync/stream.
 *   - TransferSuccessModal:   source device after transfer-out completes
 *     (instant clear + optional repurchase).
 *   - TransferredAwayModal:    hard-block for expired/revoked (not transfer-out).
 */
function SubscriptionLifecycleGates() {
  const {
    revokedReason,
    dismissRevoked,
    sourceTransferSuccessVisible,
    applySourceTransferCompleted,
    dismissSourceTransferSuccess,
    requestPaymentModal,
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
    Boolean(revokedReason) && revokedReason !== 'transferred' && !plansOpen,
  );

  const onTransferApproved = useCallback(() => {
    void applySourceTransferCompleted('transfer-approved');
  }, [applySourceTransferCompleted]);

  const onBuyAgainAfterTransfer = useCallback(() => {
    dismissSourceTransferSuccess();
    requestPaymentModal();
  }, [dismissSourceTransferSuccess, requestPaymentModal]);

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
        <TransferConfirmModal
          event={pendingTransfer}
          onDismiss={dismissPendingTransfer}
          onApproved={onTransferApproved}
        />
      ) : null}
      <TransferSuccessModal
        visible={sourceTransferSuccessVisible}
        onBuyAgain={onBuyAgainAfterTransfer}
        onDismiss={dismissSourceTransferSuccess}
      />
      <TransferredAwayModal
        visible={Boolean(revokedReason) && revokedReason !== 'transferred' && !plansOpen}
        reason={revokedReason ?? 'expired'}
        recovering={recovering}
        onRecover={onRecover}
        onOpenPlans={onOpenPlans}
      />
      <PremiumModal visible={plansOpen} onClose={onPlansClose} onUnlockSuccess={onPlansUnlock} />
    </>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
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
  offlineBanner: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offlineBannerText: {
    color: '#FDE68A',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
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
