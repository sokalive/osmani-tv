import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import EmergencyModal from './EmergencyModal';
import {
  getOsmaniNotificationPermissionGranted,
  requestOsmaniNotificationPermission,
} from '../lib/notificationPermission';
import { ensureOneSignalPushRegistration } from '../lib/oneSignalPushRegistration';
import { useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';

/**
 * Shown on app open when OneSignal reports notifications are not granted.
 */
export default function NotificationPermissionReminderGate() {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const dismissedThisForegroundRef = useRef(false);
  const checkingRef = useRef(false);

  useRegisterBlockingSheet('notification-permission-reminder', visible);

  const evaluate = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (dismissedThisForegroundRef.current) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const granted = await getOsmaniNotificationPermissionGranted();
      if (granted) {
        setVisible(false);
        void ensureOneSignalPushRegistration('permission-reminder:already-granted');
        return;
      }
      setVisible(true);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void evaluate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        dismissedThisForegroundRef.current = false;
        return;
      }
      if (state === 'active') void evaluate();
    });
    return () => sub.remove();
  }, [evaluate]);

  const onLater = useCallback(() => {
    dismissedThisForegroundRef.current = true;
    setVisible(false);
  }, []);

  const onAllow = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await requestOsmaniNotificationPermission();
      const granted = await getOsmaniNotificationPermissionGranted();
      if (granted) {
        await ensureOneSignalPushRegistration('permission-reminder:allowed');
        dismissedThisForegroundRef.current = true;
        setVisible(false);
      }
    } finally {
      setRequesting(false);
    }
  }, [requesting]);

  return (
    <EmergencyModal
      visible={visible}
      title="Pata Habari Zote Muhimu 📢"
      message="Usikose taarifa za michezo ya moja kwa moja, tamthilia mpya, vipindi vipya na matangazo muhimu ya Osmani TV. Ruhusu notifications ili upokee taarifa hizi papo hapo kwenye simu yako."
      iconName="notifications"
      primaryLabel="RUHUSU NOTIFICATIONS"
      secondaryLabel="BAADAYE"
      onSawa={onAllow}
      onSecondary={onLater}
    />
  );
}
