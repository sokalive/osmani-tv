import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  TRANSITION_MS,
  computeBannerState,
  formatCountdownClock,
  getAutoBadge,
  getCountdownState,
} from '../lib/normalizeBanner';
import {
  buildPlayerChannelFromRow,
  findRawChannelById,
} from '../lib/playerChannelFromRow';

const COLORS = {
  white: '#FFFFFF',
  mutedText: '#A1A8B5',
  greenButton: '#1EC967',
};

const AUTO_MS = 5000;
const SLIDE_HEIGHT = 210;
const RADIUS = 18;

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

/**
 * Brief crossfade triggered when a slide's engine state changes (e.g.
 * COMING_SOON → LIVE). Reuses native-driver opacity so it stays cheap on
 * low-end Android. Visual styling is unchanged — this only adds a soft
 * transition flash when the badge / countdown content swaps.
 *
 * @param {string} stateKey
 */
function useTransitionFade(stateKey) {
  const opacity = useRef(new Animated.Value(1)).current;
  const lastKey = useRef(stateKey);
  useEffect(() => {
    if (lastKey.current === stateKey) return;
    lastKey.current = stateKey;
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 0.4,
        duration: Math.floor(TRANSITION_MS / 2),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: Math.floor(TRANSITION_MS / 2),
        useNativeDriver: true,
      }),
    ]).start();
  }, [stateKey, opacity]);
  return opacity;
}

const BannerSlide = React.memo(function BannerSlide({ slide, slideWidth, nowMs }) {
  const [imageFailed, setImageFailed] = useState(false);

  // Single tick-driven derivation: state, badge, countdown all flow from
  // the same `nowMs`. Recomputed every second when the carousel is
  // mounted so badges flip the instant a window crosses a boundary.
  const computed = useMemo(() => computeBannerState(slide, nowMs), [slide, nowMs]);
  const badge = useMemo(() => getAutoBadge(slide, computed), [slide, computed]);
  const countdown = useMemo(
    () => getCountdownState(slide, nowMs, computed),
    [slide, nowMs, computed],
  );

  const badgeOpacity = useBadgePulse(badge.enabled && badge.blink);
  const overlayOpacity = useTransitionFade(`${computed.state}|${badge.text}`);

  useEffect(() => {
    setImageFailed(false);
  }, [slide.imageUrl, slide.id]);

  const countdownLabel = countdown
    ? `${countdown.prefix} ${formatCountdownClock(countdown.remainingSec)}`
    : null;

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
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)']}
        start={{ x: 0.5, y: 0.3 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {countdownLabel ? (
          <Text style={styles.countdown} numberOfLines={1}>
            {countdownLabel}
          </Text>
        ) : null}
        {badge.enabled && badge.text.length > 0 ? (
          <Animated.View
            style={[
              styles.badge,
              {
                backgroundColor: badge.color,
                opacity: badge.blink ? badgeOpacity : 1,
              },
            ]}
          >
            <Text style={styles.badgeText} numberOfLines={1}>
              {badge.text}
            </Text>
          </Animated.View>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {slide.title}
        </Text>
        {slide.description ? (
          <Text style={styles.desc} numberOfLines={1}>
            {slide.description}
          </Text>
        ) : null}
      </Animated.View>
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
  resetKey = 0,
}) {
  const scrollRef = useRef(null);
  const indexRef = useRef(0);
  const userDraggingRef = useRef(false);
  const [activeSlide, setActiveSlide] = useState(0);

  const n = slides.length;

  // Single 1Hz tick for the whole carousel. Drives the engine
  // (computeBannerState / getAutoBadge / countdown) for every mounted
  // slide so LIVE NOW / COMING SOON / COMING NEXT / ENDED transitions
  // happen instantly without polling and without per-slide intervals.
  // Cheap: one setInterval, one state setter per second, all derivations
  // are pure and gated by useMemo.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (n === 0) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [n]);

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
      const locked = !freeMode && isPremium && !isSubscribed;
      if (locked) {
        onPremiumRequired?.();
        return;
      }
      if (isPremium && !freeMode && typeof verifySubscriptionBeforePlay === 'function') {
        const ok = await verifySubscriptionBeforePlay();
        if (!ok) {
          onPremiumRequired?.();
          return;
        }
      }
      navigation.navigate('ChannelPlayer', { channel: playerChannel });
    },
    [
      rawChannels,
      freeMode,
      isSubscribed,
      maintenanceMode,
      emergencyMode,
      navigation,
      onEmergency,
      onPremiumRequired,
      verifySubscriptionBeforePlay,
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
  },
  countdown: {
    color: COLORS.greenButton,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 7,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.25,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '600',
  },
  desc: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
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
