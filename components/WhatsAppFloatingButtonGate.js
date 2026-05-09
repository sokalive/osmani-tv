import React from 'react';
import { useNavigationState } from '@react-navigation/native';
import WhatsAppFloatingButton from './WhatsAppFloatingButton';

function isHomeMainCatalogRoute(state) {
  if (!state?.routes?.length) return false;
  const route = state.routes[state.index];
  if (!route) return false;
  if (route.name === 'ChannelPlayer') return false;
  if (route.name === 'MainTabs') {
    const tabState = route.state;
    if (!tabState?.routes?.length) return false;
    const tabRoute = tabState.routes[tabState.index];
    return tabRoute?.name === 'Home';
  }
  return false;
}

/**
 * WhatsApp FAB only on Home tab (main catalog), never on player/other tabs/modals.
 */
export default function WhatsAppFloatingButtonGate() {
  const show = useNavigationState(isHomeMainCatalogRoute);
  if (!show) return null;
  return <WhatsAppFloatingButton />;
}
