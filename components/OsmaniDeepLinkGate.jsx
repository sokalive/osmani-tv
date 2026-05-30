import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { useSecurity } from '../context/SecurityContext';
import { openOsmaniDeepLink } from '../lib/openOsmaniDeepLink';
import { setOsmaniDeepLinkHandler } from '../lib/osmaniDeepLinkDispatch';

/** Ignore duplicate open events (OneSignal + Linking) within this window. */
const DEDUPE_MS = 2500;

/**
 * Context-aware deep link / notification open handler.
 * Must render inside OsmaniAppProvider, SecurityProvider, and NavigationContainer.
 *
 * @param {{
 *   navigationRef: import('@react-navigation/native').NavigationContainerRefWithCurrent<object>;
 *   pendingUrlRef: { current: string | null };
 * }} props
 */
export default function OsmaniDeepLinkGate({ navigationRef, pendingUrlRef }) {
  const {
    rawChannels,
    freeMode,
    maintenanceMode,
    emergencyMode,
    premiumPlaybackReady,
    awaitPremiumAccessSnapshot,
    requestPaymentModal,
    requestEmergencyModal,
    gateForPlayback,
  } = useOsmaniApp();
  const security = useSecurity();

  const catalogRetryUrlRef = useRef(/** @type {string | null} */ (null));
  const lastHandledRef = useRef({ url: '', at: 0 });

  const runDeepLink = useCallback(
    async (url, { fromRetry = false } = {}) => {
      const s = String(url ?? '').trim();
      if (!s) return;

      const now = Date.now();
      if (
        !fromRetry &&
        s === lastHandledRef.current.url &&
        now - lastHandledRef.current.at < DEDUPE_MS
      ) {
        return;
      }

      if (!navigationRef.isReady()) {
        pendingUrlRef.current = s;
        return;
      }

      const result = await openOsmaniDeepLink(s, {
        navigationRef,
        rawChannels,
        freeMode,
        maintenanceMode,
        emergencyMode,
        premiumPlaybackReady,
        awaitPremiumAccessSnapshot,
        requestPaymentModal,
        requestEmergencyModal,
        verifySubscriptionBeforePlay: gateForPlayback,
        security,
      });

      if (result.reason === 'nav_not_ready') {
        pendingUrlRef.current = s;
        return;
      }

      if (result.reason === 'channel_not_in_catalog') {
        catalogRetryUrlRef.current = s;
        return;
      }

      catalogRetryUrlRef.current = null;
      if (result.ok) {
        lastHandledRef.current = { url: s, at: now };
        pendingUrlRef.current = null;
      }
    },
    [
      navigationRef,
      pendingUrlRef,
      rawChannels,
      freeMode,
      maintenanceMode,
      emergencyMode,
      premiumPlaybackReady,
      awaitPremiumAccessSnapshot,
      requestPaymentModal,
      requestEmergencyModal,
      gateForPlayback,
      security,
    ],
  );

  useEffect(() => {
    setOsmaniDeepLinkHandler((url) => {
      void runDeepLink(url);
    });
    return () => setOsmaniDeepLinkHandler(null);
  }, [runDeepLink]);

  useEffect(() => {
    const retryUrl = catalogRetryUrlRef.current;
    if (!retryUrl || rawChannels.length === 0) return undefined;
    catalogRetryUrlRef.current = null;
    void runDeepLink(retryUrl, { fromRetry: true });
    return undefined;
  }, [rawChannels, runDeepLink]);

  useEffect(() => {
    let cancelled = false;

    const handleInitial = async () => {
      try {
        const initial = await Linking.getInitialURL();
        if (!cancelled && initial) {
          void runDeepLink(initial);
        }
      } catch {
        /* ignore */
      }
    };

    void handleInitial();

    const sub = Linking.addEventListener('url', ({ url }) => {
      void runDeepLink(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [runDeepLink]);

  return null;
}
