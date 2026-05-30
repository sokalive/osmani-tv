import { Alert } from 'react-native';
import { parseOsmaniDeepLink } from './osmaniDeepLink';
import { buildPlayerChannelFromRow, findRawChannelById } from './playerChannelFromRow';
import { openPremiumChannelFromSnapshot } from './premiumChannelNavigation';

/**
 * @param {Record<string, unknown>} raw
 * @returns {boolean}
 */
function isChannelPlayableInApp(raw) {
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

/**
 * @typedef {{
 *   navigationRef: import('@react-navigation/native').NavigationContainerRefWithCurrent<object>;
 *   rawChannels: unknown[];
 *   freeMode: boolean;
 *   maintenanceMode: boolean;
 *   emergencyMode: boolean;
 *   premiumPlaybackReady: boolean;
 *   awaitPremiumAccessSnapshot: () => Promise<object>;
 *   requestPaymentModal: () => void;
 *   requestEmergencyModal: () => void;
 *   verifySubscriptionBeforePlay: () => Promise<boolean>;
 *   security: object;
 * }} OpenOsmaniDeepLinkContext
 */

/**
 * @param {string} url
 * @param {OpenOsmaniDeepLinkContext} ctx
 * @returns {Promise<{ ok: boolean; reason?: string }>}
 */
export async function openOsmaniDeepLink(url, ctx) {
  const target = parseOsmaniDeepLink(url);
  if (!target) {
    console.log('[deep-link] unparseable', { url });
    return { ok: false, reason: 'unparseable' };
  }

  const { navigationRef } = ctx;
  if (!navigationRef.isReady()) {
    return { ok: false, reason: 'nav_not_ready' };
  }

  if (target.kind === 'tab') {
    console.log('[deep-link] tab', { tab: target.tab, url });
    navigationRef.navigate('MainTabs', { screen: target.tab });
    return { ok: true };
  }

  if (target.kind === 'custom') {
    console.log('[deep-link] custom_unhandled', { url: target.url });
    return { ok: false, reason: 'custom_unhandled' };
  }

  if (ctx.maintenanceMode) {
    console.log('[deep-link] channel_blocked', { reason: 'maintenance' });
    return { ok: false, reason: 'maintenance' };
  }

  if (ctx.emergencyMode) {
    ctx.requestEmergencyModal();
    console.log('[deep-link] channel_blocked', { reason: 'emergency' });
    return { ok: false, reason: 'emergency' };
  }

  const channelId = String(target.channelId ?? '').trim();
  if (!channelId) {
    return { ok: false, reason: 'missing_channel_id' };
  }

  const found = findRawChannelById(ctx.rawChannels, channelId);
  if (!found) {
    console.log('[deep-link] channel_not_in_catalog', { channelId });
    return { ok: false, reason: 'channel_not_in_catalog' };
  }

  if (!isChannelPlayableInApp(found.raw)) {
    Alert.alert('Taarifa', 'Channel hii haipatikani kwa sasa.');
    console.log('[deep-link] channel_not_playable', { channelId });
    return { ok: false, reason: 'channel_not_playable' };
  }

  const playerChannel = buildPlayerChannelFromRow(found.raw, found.index, ctx.freeMode);
  const isPremiumApi =
    found.raw?.accessType === 'premium' ||
    Boolean(found.raw?.accessPremium === true || found.raw?.access_premium === true);
  const isPremium = ctx.freeMode ? false : isPremiumApi;

  if (isPremium && !ctx.freeMode && !ctx.premiumPlaybackReady) {
    await ctx.awaitPremiumAccessSnapshot();
  }

  console.log('[deep-link] channel', { channelId, name: playerChannel?.name ?? null });
  const snapshot = await ctx.awaitPremiumAccessSnapshot();
  await openPremiumChannelFromSnapshot(snapshot, {
    playerChannel,
    cardIsPremium: isPremium,
    navigation: navigationRef,
    openPaymentModal: ctx.requestPaymentModal,
    verifySubscriptionBeforePlay: ctx.verifySubscriptionBeforePlay,
    security: ctx.security,
    Alert,
  });
  return { ok: true };
}
