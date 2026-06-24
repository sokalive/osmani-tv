import React, { useCallback, useEffect, useState } from 'react';
import ChannelUpdateGateModal from './ChannelUpdateGateModal';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { useModalSheetCoordinator, useRegisterBlockingSheet } from '../context/ModalSheetCoordinatorContext';
import { evaluateChannelUpdateGatePresentation } from '../lib/modalPriorityGuard';
import {
  isMandatoryUpdateOverlayActive,
  isUpdateOverlayVisible,
  subscribe,
} from '../lib/updateClient';

const LOG_PREFIX = '[CHANNEL_UPDATE_GATE]';

/**
 * Hosts the channel update gate modal with priority guards so it never stacks
 * on Force/Auto update, payment, or subscription lifecycle modals.
 */
export default function ChannelUpdateGateHost() {
  const {
    channelUpdateGateVisible,
    dismissChannelUpdateGate,
    presentChannelUpdateGate,
    bindPresentChannelUpdateGate,
    sourceTransferSuccessVisible,
  } = useOsmaniApp();
  const { blockingSheetIds } = useModalSheetCoordinator();
  const [updateUi, setUpdateUi] = useState(null);

  useRegisterBlockingSheet('channel-update-gate', channelUpdateGateVisible);

  useEffect(() => {
    if (typeof subscribe !== 'function') return undefined;
    return subscribe(setUpdateUi);
  }, []);

  const tryPresent = useCallback(() => {
    const mandatoryUpdateOverlayActive = isMandatoryUpdateOverlayActive();
    const updateOverlayVisible =
      updateUi?.visible === true || isUpdateOverlayVisible();
    const { defer, reason } = evaluateChannelUpdateGatePresentation({
      mandatoryUpdateOverlayActive,
      updateOverlayVisible,
      blockingSheetIds,
      channelUpdateGateVisible,
      sourceTransferSuccessVisible,
    });
    if (defer) {
      console.log(LOG_PREFIX, 'deferred', { reason, blockingSheetIds });
      return false;
    }
    presentChannelUpdateGate();
    console.log(LOG_PREFIX, 'presented');
    return true;
  }, [
    blockingSheetIds,
    channelUpdateGateVisible,
    presentChannelUpdateGate,
    sourceTransferSuccessVisible,
    updateUi?.visible,
  ]);

  useEffect(() => {
    const unbind = bindPresentChannelUpdateGate(tryPresent);
    return unbind;
  }, [bindPresentChannelUpdateGate, tryPresent]);

  return (
    <ChannelUpdateGateModal visible={channelUpdateGateVisible} onDismiss={dismissChannelUpdateGate} />
  );
}
