import React, { useEffect } from 'react';
import { Modal, View } from 'react-native';
import EmergencyModal from './EmergencyModal';
import WhatsAppFloatingButton from './WhatsAppFloatingButton';
import { useDeviceIntelligence } from '../context/DeviceIntelligenceContext';
import { registerDeviceIntelligenceNavigateHome } from '../lib/deviceIntelligenceAccess';
import { useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';

/**
 * Users Intelligence block / unblock modals (Osmani centered popup).
 * WhatsApp FAB stays reachable while blocked (including when the block modal is open).
 *
 * @param {{ navigationRef: import('@react-navigation/native').NavigationContainerRefWithCurrent<object> }} props
 */
export default function DeviceIntelligenceGate({ navigationRef }) {
  const {
    blocked,
    blockedModalVisible,
    unblockModalVisible,
    acknowledgeBlockedNotice,
    dismissUnblockModal,
  } = useDeviceIntelligence();

  useEffect(() => {
    registerDeviceIntelligenceNavigateHome(() => {
      try {
        if (!navigationRef?.isReady?.()) return;
        navigationRef.navigate('MainTabs', { screen: 'Home' });
      } catch {
        /* ignore */
      }
    });
    return () => registerDeviceIntelligenceNavigateHome(null);
  }, [navigationRef]);

  const blockSheetVisible = Boolean(blockedModalVisible);
  useRegisterBlockingSheet('device-intelligence-blocked', blockSheetVisible);
  useRegisterBlockingSheet('device-intelligence-unblocked', unblockModalVisible);

  return (
    <>
      <EmergencyModal
        visible={blockSheetVisible}
        title="Akaunti Imefungiwa"
        message="Matumizi ya Osmani TV kwenye kifaa hiki yamefungiwa. Tafadhali wasiliana na huduma kwa wateja kwa maelezo zaidi."
        iconName="warning"
        primaryLabel="Nimeelewa"
        onSawa={acknowledgeBlockedNotice}
      />
      <EmergencyModal
        visible={unblockModalVisible}
        title="Akaunti Imefunguliwa"
        message="Akaunti yako imefunguliwa. Tafadhali zingatia sheria za matumizi ya Osmani TV ili kuepuka kufungiwa tena."
        iconName="warning"
        primaryLabel="Nimekubali"
        onSawa={dismissUnblockModal}
      />
      {blocked ? (
        <Modal visible transparent animationType="none" onRequestClose={() => {}}>
          <View style={{ flex: 1 }} pointerEvents="box-none">
            <WhatsAppFloatingButton />
          </View>
        </Modal>
      ) : null}
    </>
  );
}
