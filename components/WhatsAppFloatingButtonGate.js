import React, { useEffect, useMemo, useState } from 'react';
import WhatsAppFloatingButton from './WhatsAppFloatingButton';

/**
 * Derive visibility from root navigation state (Home tab only, not Channel Player).
 * Uses NavigationContainerRef — safe outside navigator tree (no useNavigationState).
 */
function shouldShowWhatsAppFab(rootState) {
  try {
    if (!rootState?.routes?.length) return false;
    const route = rootState.routes[rootState.index];
    if (!route) return false;
    if (route.name === 'ChannelPlayer') return false;
    if (route.name === 'MainTabs') {
      const tabState = route.state;
      if (!tabState?.routes?.length) return false;
      const tabRoute = tabState.routes[tabState.index];
      return tabRoute?.name === 'Home';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {{ navigationRef: import('@react-navigation/native').NavigationContainerRef | null | undefined; navigationRevision?: number }} props
 */
export default function WhatsAppFloatingButtonGate({ navigationRef, navigationRevision = 0 }) {
  const [visible, setVisible] = useState(false);

  const readyAndState = useMemo(() => {
    try {
      if (!navigationRef || typeof navigationRef.isReady !== 'function') {
        return { ready: false, state: null };
      }
      if (!navigationRef.isReady()) {
        return { ready: false, state: null };
      }
      const state =
        typeof navigationRef.getRootState === 'function' ? navigationRef.getRootState() : null;
      return { ready: true, state };
    } catch {
      return { ready: false, state: null };
    }
  }, [navigationRef, navigationRevision]);

  useEffect(() => {
    try {
      if (!readyAndState.ready || !readyAndState.state) {
        setVisible(false);
        return;
      }
      setVisible(shouldShowWhatsAppFab(readyAndState.state));
    } catch {
      setVisible(false);
    }
  }, [readyAndState]);

  if (!visible) return null;
  return <WhatsAppFloatingButton />;
}
