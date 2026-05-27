import React, { useEffect, useState } from 'react';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';
import PremiumModal from './PremiumModal';

/**
 * Opens PremiumModal from anywhere (e.g. trial expiry on the player screen).
 */
export default function GlobalPaymentModalGate() {
  const { paymentModalRequest, reverifySubscription } = useOsmaniApp();
  const [visible, setVisible] = useState(false);
  useRegisterBlockingSheet('global-payment-modal', visible);

  useEffect(() => {
    if (!paymentModalRequest) return;
    setVisible(true);
  }, [paymentModalRequest]);

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
