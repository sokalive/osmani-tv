import React, { useEffect, useState } from 'react';
import { useDeviceIntelligence } from '../context/DeviceIntelligenceContext';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';
import PremiumModal from './PremiumModal';

/**
 * Opens PremiumModal from anywhere (e.g. trial expiry on the player screen).
 */
export default function GlobalPaymentModalGate() {
  const { paymentModalRequest, reverifySubscription } = useOsmaniApp();
  const { blocked: deviceIntelligenceBlocked, guardUsage: guardDeviceIntelligence } =
    useDeviceIntelligence();
  const [visible, setVisible] = useState(false);
  useRegisterBlockingSheet('global-payment-modal', visible);

  useEffect(() => {
    if (!paymentModalRequest || deviceIntelligenceBlocked) {
      if (deviceIntelligenceBlocked && paymentModalRequest) guardDeviceIntelligence();
      return;
    }
    setVisible(true);
  }, [paymentModalRequest, deviceIntelligenceBlocked, guardDeviceIntelligence]);

  return (
    <PremiumModal
      visible={visible}
      onClose={() => setVisible(false)}
      onUnlockSuccess={() => {
        setVisible(false);
        void reverifySubscription('trial-payment-unlock');
      }}
    />
  );
}
