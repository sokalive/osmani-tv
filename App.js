import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import EmergencyModal from './components/EmergencyModal';
import MaintenanceScreen from './components/MaintenanceScreen';
import PremiumModal from './components/PremiumModal';
import AkauntiYanguScreen from './screens/AkauntiYanguScreen';
import ChannelPlayerScreen from './screens/ChannelPlayerScreen';
import { OsmaniAppProvider, useOsmaniApp } from './context/OsmaniAppContext';
import { BASE_URL } from './api';
import { resolveStream } from './lib/channelStream';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Demo stream when card has no `streamUrl` — replace with live URLs per channel */
const DEFAULT_STREAM_URI =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const { width } = Dimensions.get('window');
const HORIZONTAL_PADDING = 16;
const GRID_GAP = 12;
const CARD_WIDTH = (width - HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 4) / 3);
const CAROUSEL_SLIDE_WIDTH = width - HORIZONTAL_PADDING * 2;

const COLORS = {
  background: '#111215',
  card: '#1A1D23',
  live: '#1BCB5A',
  free: '#2AAE5E',
  yellow: '#FFCB3D',
  greenButton: '#1EC967',
  filterPill: '#2A2E37',
  filterSelected: '#3A4151',
  mutedText: '#A1A8B5',
  nav: '#171A20',
  white: '#FFFFFF',
};

const carouselData = [
  {
    id: '1',
    title: 'Live Match 1',
    image: 'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: '2',
    title: 'Live Match 2',
    image: 'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: '3',
    title: 'Live Match 3',
    image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: '4',
    title: 'Live Match 4',
    image: 'https://images.unsplash.com/photo-1602074819641-9436cc804f2f?auto=format&fit=crop&w=1400&q=80',
  },
];

const filters = ['Zote', 'Trending', 'Sports', 'Movies'];

const TAB_BAR_HEIGHT = 76;
/** Small gap between safe-area bottom and the tab bar (comfortable, not touching system nav). */
const TAB_BAR_FLOAT_GAP = 4;
/** Space between last scroll content and top of the tab bar. */
const CONTENT_ABOVE_TAB_GAP = 28;

function getScrollContentBottomPadding(insets) {
  const tabBottomOffset = insets.bottom + TAB_BAR_FLOAT_GAP;
  const reserved = TAB_BAR_HEIGHT + tabBottomOffset + CONTENT_ABOVE_TAB_GAP;
  return Math.max(100, reserved);
}

/** Placeholder art when the API does not send a poster URL */
const DEFAULT_CHANNEL_CARD_IMAGE =
  'https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=900&q=80';

function resolveChannelCardImage(raw) {
  const rel = raw?.thumbnail != null ? String(raw.thumbnail).trim() : '';
  const abs = raw?.thumbnailUrl != null ? String(raw.thumbnailUrl).trim() : '';
  if (abs.startsWith('http')) return abs;
  if (rel.startsWith('http')) return rel;
  if (rel.startsWith('/')) return `${BASE_URL}${rel}`;
  if (rel.length > 0) return `${BASE_URL}/${rel}`;
  return DEFAULT_CHANNEL_CARD_IMAGE;
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

function matchesBottomTabRow(r, filter) {
  if (filter == null || String(filter).trim() === '') return true;
  const v = String(r.bottomTab ?? r.bottomTabsDisplay ?? r.category ?? '').trim();
  return v.toLowerCase() === String(filter).trim().toLowerCase();
}

function matchesPillFilter(r, pill) {
  if (pill === 'Zote' || pill === 'Trending') return true;
  if (pill === 'Sports' || pill === 'Movies') {
    const want = pill.toLowerCase();
    const cat = String(r.category ?? '').trim().toLowerCase();
    const bt = String(r.bottomTab ?? r.bottomTabsDisplay ?? '').trim().toLowerCase();
    return cat === want || bt === want;
  }
  return true;
}

function mapApiChannelToCard(raw, index, freeMode = false) {
  const name = raw?.name != null ? String(raw.name) : `Channel ${index + 1}`;
  const stableId =
    raw?.id != null && String(raw.id).length > 0 ? String(raw.id) : `ch-${index}-${name.slice(0, 24)}`;
  const isLive = raw?.isLive !== undefined ? Boolean(raw.isLive) : Boolean(raw?.live);
  const isHD = raw?.isHD !== undefined ? Boolean(raw.isHD) : raw?.hd !== false;
  const isPremiumApi =
    raw?.accessType === 'premium' || Boolean(raw?.accessPremium === true || raw?.access_premium === true);
  const isPremium = freeMode ? false : isPremiumApi;
  const category = raw?.category != null ? String(raw.category) : '';
  const resolved = resolveStream(raw);
  const playerChannel = {
    name,
    url: typeof raw?.url === 'string' ? raw.url : '',
    backupStream1: typeof raw?.backupStream1 === 'string' ? raw.backupStream1 : '',
    backupStream2: typeof raw?.backupStream2 === 'string' ? raw.backupStream2 : '',
    origin: typeof raw?.origin === 'string' ? raw.origin : '',
    referer: typeof raw?.referer === 'string' ? raw.referer : '',
    userAgent: typeof raw?.userAgent === 'string' ? raw.userAgent : '',
    playerType: raw?.playerType != null ? String(raw.playerType) : 'exo',
    accessType: freeMode ? 'free' : isPremiumApi ? 'premium' : 'free',
    accessPremium: freeMode ? false : isPremiumApi,
  };
  return {
    id: stableId,
    title: name,
    subtitle: category || 'Live Channel',
    showHD: isHD,
    liveLabel: isLive ? 'LIVE' : 'OFFLINE',
    livePillColor: isLive ? '#DC2626' : '#4B5563',
    accessBadge: isPremium ? 'KULIPIA' : 'BURE',
    accessBadgeColor: isPremium ? COLORS.yellow : COLORS.free,
    image: resolveChannelCardImage(raw),
    bottomTab: String(raw?.bottomTab ?? raw?.bottomTabsDisplay ?? category ?? '').trim(),
    streamUrl: resolved || DEFAULT_STREAM_URI,
    playerChannel,
    isPremium,
  };
}

function ChannelCatalogScreen({ navigation, bottomTabFilter = null }) {
  const insets = useSafeAreaInsets();
  const {
    freeMode,
    emergencyMode,
    maintenanceMode,
    rawChannels,
    loading,
    error,
    refresh,
    isSubscribed,
    setIsSubscribed,
  } = useOsmaniApp();
  const [activeSlide, setActiveSlide] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState('Zote');
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [emergencyModalVisible, setEmergencyModalVisible] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!emergencyMode) setEmergencyModalVisible(false);
  }, [emergencyMode]);

  const carouselRef = useRef(null);
  const carouselIndexRef = useRef(0);
  const userDraggingRef = useRef(false);

  const listBottomPadding = getScrollContentBottomPadding(insets);

  const displayChannels = useMemo(() => {
    let rows = rawChannels.filter(channelVisibleInApp);
    if (bottomTabFilter) {
      rows = rows.filter((r) => matchesBottomTabRow(r, bottomTabFilter));
    }
    if (selectedFilter === 'Trending') {
      rows = rows.filter((r) => Boolean(r.isLive ?? r.live));
    } else if (selectedFilter === 'Sports' || selectedFilter === 'Movies') {
      rows = rows.filter((r) => matchesPillFilter(r, selectedFilter));
    }
    return rows.map((raw, i) => mapApiChannelToCard(raw, i, freeMode));
  }, [rawChannels, bottomTabFilter, selectedFilter, freeMode]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh({ showGlobalLoading: false });
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    carouselIndexRef.current = 0;
    setActiveSlide(0);
    setSelectedFilter('Zote');
    setRefreshKey((k) => k + 1);
    refresh({ showGlobalLoading: false });
  }, [refresh]);

  const onScrollCarousel = useCallback((event) => {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.min(
      carouselData.length - 1,
      Math.max(0, Math.round(x / CAROUSEL_SLIDE_WIDTH))
    );
    carouselIndexRef.current = idx;
    setActiveSlide((prev) => (prev === idx ? prev : idx));
  }, []);

  const onCarouselScrollBegin = useCallback(() => {
    userDraggingRef.current = true;
  }, []);

  const onCarouselMomentumEnd = useCallback((event) => {
    userDraggingRef.current = false;
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.min(
      carouselData.length - 1,
      Math.max(0, Math.round(x / CAROUSEL_SLIDE_WIDTH))
    );
    carouselIndexRef.current = idx;
    setActiveSlide(idx);
  }, []);

  useEffect(() => {
    const n = carouselData.length;
    if (n === 0) return undefined;
    const id = setInterval(() => {
      if (userDraggingRef.current) return;
      const next = (carouselIndexRef.current + 1) % n;
      carouselIndexRef.current = next;
      setActiveSlide(next);
      carouselRef.current?.scrollTo({
        x: next * CAROUSEL_SLIDE_WIDTH,
        y: 0,
        animated: true,
      });
    }, 3000);
    return () => clearInterval(id);
  }, [refreshKey]);

  const renderCard = ({ item }) => {
    const locked = !freeMode && item.isPremium && !isSubscribed;
    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          if (maintenanceMode) return;
          if (emergencyMode) {
            setEmergencyModalVisible(true);
            return;
          }
          if (locked) {
            setPremiumModalVisible(true);
          } else {
            navigation.navigate('ChannelPlayer', {
              channel: item.playerChannel,
            });
          }
        }}
      >
        <View style={styles.cardImageWrap}>
          <ExpoImage source={item.image} style={styles.cardImage} contentFit="cover" transition={120} />
          <View style={styles.cardBadgesRow} pointerEvents="none">
            {item.showHD ? (
              <View style={styles.hdBadge}>
                <Text style={styles.hdBadgeText}>HD</Text>
              </View>
            ) : (
              <View style={styles.hdBadgePlaceholder} />
            )}
            <View style={styles.cardBadgesRight}>
              <View style={[styles.statusPill, { backgroundColor: item.livePillColor }]}>
                <Text style={styles.liveBadgeText}>{item.liveLabel}</Text>
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
          {locked ? (
            <View style={styles.lockOverlay} pointerEvents="none">
              <Ionicons name="lock-closed" size={28} color={COLORS.white} />
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.topRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleLine}>
              <Text style={styles.appTitle}>Osmani TV</Text>
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

        <View style={styles.carouselWrap}>
          <ScrollView
            ref={carouselRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScrollCarousel}
            onScrollBeginDrag={onCarouselScrollBegin}
            onMomentumScrollEnd={onCarouselMomentumEnd}
            scrollEventThrottle={16}
            decelerationRate="fast"
          >
            {carouselData.map((slide) => (
              <View key={slide.id} style={styles.carouselSlide}>
                <ExpoImage source={slide.image} style={styles.carouselImage} contentFit="cover" transition={140} />
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)']}
                  start={{ x: 0.5, y: 0.3 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.carouselGradient}
                />
                <View style={styles.carouselOverlay}>
                  <Text style={styles.carouselTitle}>{slide.title}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.dotsRow}>
            {carouselData.map((dot, index) => (
              <View
                key={dot.id}
                style={[styles.dot, activeSlide === index ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>
        </View>

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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Michezo na Soka</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{displayChannels.length}</Text>
          </View>
        </View>
      </View>
    ),
    [
      activeSlide,
      selectedFilter,
      handleRefresh,
      onScrollCarousel,
      onCarouselScrollBegin,
      onCarouselMomentumEnd,
      displayChannels.length,
      loading,
      error,
    ]
  );

  if (maintenanceMode) {
    return (
      <MaintenanceScreen
        contentPaddingBottom={listBottomPadding}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={['top']}>
      <StatusBar style="light" />
      <FlatList
        key={String(refreshKey)}
        data={displayChannels}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !loading ? <Text style={styles.channelsEmptyText}>Hakuna chaneli bado.</Text> : null
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
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
      <EmergencyModal
        visible={emergencyModalVisible}
        onSawa={() => setEmergencyModalVisible(false)}
      />
      <PremiumModal
        visible={premiumModalVisible}
        onClose={() => setPremiumModalVisible(false)}
        onUnlockSuccess={() => setIsSubscribed(true)}
      />
    </SafeAreaView>
  );
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
  const insets = useSafeAreaInsets();

  const tabBarBottomOffset = insets.bottom + TAB_BAR_FLOAT_GAP;

  const tabBarStyle = useMemo(
    () => ({
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: tabBarBottomOffset,
      height: TAB_BAR_HEIGHT,
      backgroundColor: COLORS.nav,
      borderTopWidth: 0,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 8,
      paddingBottom: 12,
      elevation: 18,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.22,
      shadowRadius: 14,
    }),
    [tabBarBottomOffset]
  );

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: COLORS.background },
        tabBarStyle,
        tabBarSafeAreaInsets: { bottom: 0 },
        tabBarActiveTintColor: COLORS.white,
        tabBarInactiveTintColor: '#8C92A0',
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ color, size, focused }) => {
          const iconMap = {
            Home: 'home',
            Sports: 'football',
            Tamthilia: 'film',
            'Akaunti Yangu': 'person-circle',
          };
          const iconName = iconMap[route.name];
          return <Ionicons name={iconName} size={focused ? size + 1 : size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home">{(props) => <ChannelCatalogScreen {...props} bottomTabFilter={null} />}</Tab.Screen>
      <Tab.Screen name="Sports">
        {(props) => <ChannelCatalogScreen {...props} bottomTabFilter="Sports" />}
      </Tab.Screen>
      <Tab.Screen name="Tamthilia">
        {(props) => <ChannelCatalogScreen {...props} bottomTabFilter="Movies" />}
      </Tab.Screen>
      <Tab.Screen name="Akaunti Yangu" component={AkauntiYanguScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <OsmaniAppProvider>
        <NavigationContainer
          theme={{
            ...DarkTheme,
            colors: { ...DarkTheme.colors, background: COLORS.background, card: COLORS.nav },
          }}
        >
          <RootNavigator />
        </NavigationContainer>
      </OsmaniAppProvider>
    </SafeAreaProvider>
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
  carouselWrap: {
    marginTop: 12,
  },
  carouselSlide: {
    width: CAROUSEL_SLIDE_WIDTH,
    height: 210,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#242B3A',
  },
  carouselImage: {
    width: '100%',
    height: '100%',
  },
  carouselGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  carouselOverlay: {
    position: 'absolute',
    left: 16,
    bottom: 16,
  },
  carouselTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '600',
  },
  dotsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    borderRadius: 20,
    marginHorizontal: 4,
  },
  dotActive: {
    width: 9,
    height: 9,
    backgroundColor: COLORS.white,
  },
  dotInactive: {
    width: 7,
    height: 7,
    backgroundColor: 'rgba(255,255,255,0.4)',
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
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
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
