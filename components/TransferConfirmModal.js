import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { respondToTransfer } from '../api/subscription';

/**
 * Source-device confirmation popup. Triggered by the SSE event
 * `transfer_requested` (payload: { code, target_device_label?, … }).
 * The user can Approve or Reject. Both responses POST to
 * /api/transfer/respond.
 *
 * The modal does not block the rest of the app — it is auxiliary; the
 * hard-block is `TransferredAwayModal`, which appears after the
 * backend confirms the transfer (`transfer_completed` / verify=false).
 */
export default function TransferConfirmModal({ event, onDismiss }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setBusy('');
    setError('');
  }, [event?.code]);

  const close = useCallback(() => {
    setBusy('');
    setError('');
    onDismiss?.();
  }, [onDismiss]);

  const respond = useCallback(
    async (decision) => {
      if (!event?.code) {
        close();
        return;
      }
      try {
        setBusy(decision);
        setError('');
        await respondToTransfer(event.code, decision);
        console.log('[TRANSFER_RESPOND]', 'sent', { code: event.code, decision });
        close();
      } catch (e) {
        const msg = e?.message ?? String(e ?? 'unknown_error');
        console.log('[TRANSFER_RESPOND]', 'failed', msg);
        setError(msg);
      } finally {
        setBusy('');
      }
    },
    [close, event?.code],
  );

  if (!event) return null;

  const targetLabel =
    String(event.target_device_label ?? event.targetDevice ?? event.target_label ?? '').trim() ||
    'kifaa kingine';

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="swap-horizontal" size={32} color="#FBBF24" />
          </View>
          <Text style={styles.title}>Hamisha Kifurushi?</Text>
          <Text style={styles.body}>
            Kuna ombi la kuhamisha kifurushi chako kwenda <Text style={styles.bodyBold}>{targetLabel}</Text>.
            Ukikubali, kifaa hiki kitapoteza ufikiaji wa channel za kulipia mara moja.
          </Text>
          {event.code ? (
            <Text style={styles.codeLabel}>
              Code: <Text style={styles.codeValue}>{String(event.code)}</Text>
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <Pressable
              onPress={() => respond('reject')}
              disabled={busy !== ''}
              style={[styles.btn, styles.rejectBtn, busy !== '' && styles.disabled]}
            >
              {busy === 'reject' ? (
                <ActivityIndicator color="#FCA5A5" />
              ) : (
                <Text style={styles.rejectText}>KATAA</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => respond('approve')}
              disabled={busy !== ''}
              style={[styles.btn, styles.approveBtn, busy !== '' && styles.disabled]}
            >
              {busy === 'approve' ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <Text style={styles.approveText}>KUBALI</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#13161D',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.32)',
    ...Platform.select({
      android: { elevation: 14 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
      default: {},
    }),
  },
  iconWrap: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(251,191,36,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    marginTop: 10,
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  bodyBold: {
    color: '#FBBF24',
    fontWeight: '700',
  },
  codeLabel: {
    marginTop: 14,
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  codeValue: {
    color: '#F8FAFC',
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  error: {
    marginTop: 12,
    color: '#FCA5A5',
    fontSize: 12,
    textAlign: 'center',
  },
  row: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.55)',
  },
  approveBtn: {
    backgroundColor: '#FBBF24',
  },
  rejectText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  approveText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  disabled: {
    opacity: 0.55,
  },
});
