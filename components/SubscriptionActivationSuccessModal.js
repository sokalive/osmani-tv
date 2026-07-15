import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import PaymentSuccessStep from './PaymentSuccessStep';

const ACTIVATION_COPY = {
  admin_grant: {
    subtitle: 'Umepokea kifurushi kutoka kwa msimamizi.',
    message: 'Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.',
  },
  offer_code: {
    subtitle: 'Umefanikiwa kutumia code ya ofa.',
    message: 'Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.',
  },
  transfer: {
    subtitle: 'Kifurushi kimehamishwa kwenye kifaa hiki.',
    message: 'Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.',
  },
  custom_grant: {
    subtitle: 'Umepokea kifurushi maalum.',
    message: 'Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.',
  },
  payment: {
    subtitle: 'Umefanikiwa kununua kifurushi.',
    message: 'Sasa unaweza kutazama channel zote za Premium Live kuanzia muda huu.',
  },
};

/**
 * Global success dialog for non–PremiumModal activation paths (admin grant, offer, transfer).
 */
export default function SubscriptionActivationSuccessModal({
  visible,
  details,
  source = 'admin_grant',
  onDismiss,
}) {
  const copy = ACTIVATION_COPY[source] ?? ACTIVATION_COPY.admin_grant;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <PaymentSuccessStep
            details={details}
            subtitle={copy.subtitle}
            message={copy.message}
            onOpenChannel={onDismiss}
            onDismiss={onDismiss}
            channelButtonLabel="✅ Fungua Channel"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0F1115',
  },
});
