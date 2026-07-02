import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { assertPlaybackAllowed, useSecurity } from '../context/SecurityContext';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  bannerNeedsRuntimeTick,
  getBannerRuntimeState,
  getSlideBadgePosition,
} from '../lib/normalizeBanner';
import {
  buildPlayerChannelFromRow,
  findRawChannelById,
} from '../lib/playerChannelFromRow';
import { openPremiumChannelFromSnapshot } from '../lib/premiumChannelNavigation';
import { awaitPremiumSnapshotCapped } from '../lib/premiumTapGate';

const COLORS = {
  white: '#FFFFFF',
  mutedText: '#A1A8B5',
  greenButton: '#1EC967',
  pillRed: '#DC2626',
};

const AUTO_MS = 5000;
const SLIDE_HEIGHT = 210;
const RADIUS = 18;
const RUNTIME_SAFE_SIDE = 12;
const RUNTIME_SAFE_TOP = 12;
/** Space above title / carousel dots inside the slide safe area. */
const RUNTIME_SAFE_BOTTOM = 40;

/** @typedef {'center' | 'bottom_center' | 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right'} RuntimePositionPreset */

/** @type {Record<RuntimePositionPreset, import('react-native').ViewStyle>} */
const RUNTIME_OVERLAY_PRESETS = {
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottom_center: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: RUNTIME_SAFE_BOTTOM,
  },
  bottom_left: {
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingBottom: RUNTIME_SAFE_BOTTOM,
    paddingLeft: RUNTIME_SAFE_SIDE,
  },
  bottom_right: {
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: RUNTIME_SAFE_BOTTOM,
    paddingRight: RUNTIME_SAFE_SIDE,
  },
  top_left: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: RUNTIME_SAFE_TOP,
    paddingLeft: RUNTIME_SAFE_SIDE,
  },
  top_right: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: RUNTIME_SAFE_TOP,
    paddingRight: RUNTIME_SAFE_SIDE,
  },
};

/** @param {RuntimePositionPreset} position */
function getRuntimeOverlayStyle(position) {
  if (Object.prototype.hasOwnProperty.call(RUNTIME_OVERLAY_PRESETS, position)) {
    return RUNTIME_OVERLAY_PRESETS[position];
  }
  return null;
}

/** @param {{ children: string; pulse?: boolean }} props */
function RuntimeStatusPill({ children, pulse = false }) {
  const opacity = useBadgePulse(pulse);
  return (
    <Animated.View
      style={[
        styles.runtimePill,
        styles.pillRed,
        pulse ? styles.pillRedLive : null,
        pulse ? { opacity } : null,
      ]}
    >
      <Text style={styles.runtimePillText} numberOfLines={2}>
        {children}
      </Text>
    </Animated.View>
  );
}

function useBadgePulse(enabled) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, opacity]);
  return opacity;
}

const BannerSlide = React.memo(function BannerSlide({ slide, slideWidth, nowMs }) {
  const [imageFailed, setImageFailed] = useState(false);
  const runtime = useMemo(
    () => getBannerRuntimeState(slide, nowMs),
    [slide, nowMs],
  );
  const showRuntimeUi = runtime != null;

  const showAdminBadge =
    !showRuntimeUi && slide.badgeEnabled && slide.badgeText.length > 0;
  const badgeOpacity = useBadgePulse(showAdminBadge && slide.badgeBlink);
  const badgePosition = getSlideBadgePosition(slide);
  const badgeOverlayStyle = getRuntimeOverlayStyle(badgePosition);

  useEffect(() => {
    setImageFailed(false);
  }, [slide.imageUrl, slide.id]);

  return (
    <View style={[styles.slide, { width: slideWidth }]}>
      {!imageFailed && slide.imageUrl ? (
        <Image
          source={{ uri: slide.imageUrl }}
          style={styles.image}
          contentFit="cover"
          transition={140}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <LinearGradient
          colors={['#2A3142', '#1A1D23', '#242B3A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.image}
        />
      )}
      <LinearGradient
        colors={
          showRuntimeUi
            ? ['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']
            : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)']
        }
        start={{ x: 0.5, y: 0.25 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.overlay, styles.textOverlay]} pointerEvents="none">
        <View style={styles.contentStack}>
          {showRuntimeUi ? (
            <RuntimeStatusPill pulse={runtime.pulse}>{runtime.statusLine}</RuntimeStatusPill>
          ) : null}
          <Text
            style={[styles.title, showRuntimeUi ? styles.titleWithRuntime : null]}
            numberOfLines={showRuntimeUi ? 1 : 2}
          >
            {slide.title}
          </Text>
          {slide.description ? (
            <Text style={styles.desc} numberOfLines={2}>
              {slide.description}
            </Text>
          ) : null}
        </View>
      </View>
      {showAdminBadge && badgeOverlayStyle ? (
        <View style={[styles.badgeOverlay, badgeOverlayStyle]} pointerEvents="none">
          <Animated.View
            style={[
              styles.badge,
              {
                backgroundColor: slide.badgeColor,
                opacity: slide.badgeBlink ? badgeOpacity : 1,
              },
            ]}
          >
            <Text style={styles.badgeText} numberOfLines={1}>
              {slide.badgeText}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
});

export function BannerCarouselSkeleton({ slideWidth }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.65, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [pulse]);
  return (
    <View style={[styles.skeletonWrap, { width: slideWidth }]}>
      <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]} />
      <View style={styles.skeletonDots}>
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonDot} />
      </View>
    </View>
  );
}

function BannerCarousel({
  slides,
  slideWidth,
  rawChannels,
  freeMode,
  isSubscribed,
  maintenanceMode,
  emergencyMode,
  navigation,
  onEmergency,
  onPremiumRequired,
  verifySubscriptionBeforePlay,
  awaitPremiumAccessSnapshot,
  premiumPlaybackReady,
  getPremiumAccessSnapshot,
  awaitRecoverBoot,
  openPaymentModal,
  resetKey = 0,
  requireUpdateBeforeChannelPlayback = false,
  onChannelUpdateRequired,
}) {
  const security = useSecurity();
  const scrollRef = useRef(null);
  const indexRef = useRef(0);
  const userDraggingRef = useRef(false);
  const [activeSlide, setActiveSlide] = useState(0);

  const needsRuntimeTick = useMemo(
    () => slides.some((s) => bannerNeedsRuntimeTick(s)),
    [slides],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!needsRuntimeTick) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [needsRuntimeTick]);

  const n = slides.length;

  useEffect(() => {
    indexRef.current = 0;
    setActiveSlide(0);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [n, resetKey]);

  useEffect(() => {
    if (n === 0) return undefined;
    const id = setInterval(() => {
      if (userDraggingRef.current) return;
      const next = (indexRef.current + 1) % n;
      indexRef.current = next;
      setActiveSlide(next);
      scrollRef.current?.scrollTo({
        x: next * slideWidth,
        y: 0,
        animated: true,
      });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [n, slideWidth, resetKey]);

  const preloadNext = useMemo(() => {
    if (n <= 1) return null;
    const next = (activeSlide + 1) % n;
    const uri = slides[next]?.imageUrl;
    return uri || null;
  }, [activeSlide, n, slides]);

  useEffect(() => {
    if (!preloadNext) return;
    Image.prefetch(preloadNext).catch(() => {});
  }, [preloadNext]);

  const onScroll = useCallback(
    (event) => {
      if (n <= 0) return;
      const x = event.nativeEvent.contentOffset.x;
      const idx = Math.min(n - 1, Math.max(0, Math.round(x / slideWidth)));
      indexRef.current = idx;
      setActiveSlide((prev) => (prev === idx ? prev : idx));
    },
    [n, slideWidth],
  );

  const onScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true;
  }, []);

  const onMomentumEnd = useCallback(
    (event) => {
      userDraggingRef.current = false;
      if (n <= 0) return;
      const x = event.nativeEvent.contentOffset.x;
      const idx = Math.min(n - 1, Math.max(0, Math.round(x / slideWidth)));
      indexRef.current = idx;
      setActiveSlide(idx);
    },
    [n, slideWidth],
  );

  const tryOpenChannel = useCallback(
    async (slide) => {
      if (!slide.redirectChannelId) return;
      if (maintenanceMode) return;
      if (emergencyMode) {
        onEmergency?.();
        return;
      }
      const found = findRawChannelById(rawChannels, slide.redirectChannelId);
      if (!found) return;
      const { raw, index } = found;
      const playerChannel = buildPlayerChannelFromRow(raw, index, freeMode);
      const isPremiumApi =
        raw?.accessType === 'premium' ||
        Boolean(raw?.accessPremium === true || raw?.access_premium === true);
      const isPremium = freeMode ? false : isPremiumApi;
      const snapshot = await awaitPremiumSnapshotCapped(
        getPremiumAccessSnapshot,
        awaitPremiumAccessSnapshot,
      );
      await openPremiumChannelFromSnapshot(snapshot, {
        playerChannel,
        cardIsPremium: isPremium,
        navigation,
        openPaymentModal: () => {
          const fn = openPaymentModal ?? onPremiumRequired ?? (() => {});
          fn(playerChannel);
        },
        verifySubscriptionBeforePlay,
        security,
        Alert,
      });
    },
    [
      rawChannels,
      freeMode,
      maintenanceMode,
      emergencyMode,
      navigation,
      onEmergency,
      onPremiumRequired,
      verifySubscriptionBeforePlay,
      awaitPremiumAccessSnapshot,
      getPremiumAccessSnapshot,
      openPaymentModal,
      security,
    ],
  );

  if (n === 0) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
      >
        {slides.map((slide) => {
          const pressable = Boolean(slide.redirectChannelId);
          const inner = (
            <BannerSlide
              slide={slide}
              slideWidth={slideWidth}
              nowMs={nowMs}
            />
          );
          if (!pressable) {
            return (
              <View key={slide.id} style={styles.slideTouch}>
                {inner}
              </View>
            );
          }
          return (
            <Pressable
              key={slide.id}
              style={styles.slideTouch}
              onPress={() => {
                void tryOpenChannel(slide);
              }}
            >
              {inner}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.dotsRow}>
        {slides.map((dot, index) => (
          <View
            key={dot.id}
            style={[styles.dot, activeSlide === index ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  slideTouch: {
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  slide: {
    height: SLIDE_HEIGHT,
    borderRadius: RADIUS,
    overflow: 'hidden',
    backgroundColor: '#242B3A',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 20,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  textOverlay: {
    zIndex: 4,
    elevation: 4,
  },
  contentStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '94%',
  },
  badgeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 8,
    elevation: 8,
  },
  runtimePill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    marginBottom: 6,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
  },
  pillRed: {
    backgroundColor: COLORS.pillRed,
  },
  pillRedLive: {
    shadowColor: '#FF4D4D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 8,
  },
  runtimePillText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.35,
  },
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '68%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 0,
    elevation: 5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  titleWithRuntime: {
    fontSize: 16,
  },
  desc: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  skeletonWrap: {
    marginTop: 12,
  },
  skeletonBlock: {
    height: SLIDE_HEIGHT,
    borderRadius: RADIUS,
    backgroundColor: '#242B3A',
  },
  skeletonDots: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  skeletonDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});

export default React.memo(BannerCarousel);
