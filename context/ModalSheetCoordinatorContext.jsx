import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PREFIX = '[MODAL_COORD]';

const ModalSheetCoordinatorContext = createContext(null);

/**
 * Tracks overlapping RN Modal / sheet presentations to avoid MAX_SHEET_COUNT crashes.
 * Register each blocking overlay while `active`; unregister on cleanup.
 */
export function ModalSheetCoordinatorProvider({ children }) {
  const [blockingIds, setBlockingIds] = useState(() => new Set());

  const registerBlockingSheet = useCallback((id) => {
    if (!id) return;
    setBlockingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      if (__DEV__) {
        console.log(PREFIX, 'register', id, 'count=', next.size, 'ids=', [...next]);
      }
      return next;
    });
  }, []);

  const unregisterBlockingSheet = useCallback((id) => {
    if (!id) return;
    setBlockingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      if (__DEV__) {
        console.log(PREFIX, 'unregister', id, 'count=', next.size, 'ids=', [...next]);
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      registerBlockingSheet,
      unregisterBlockingSheet,
      blockingSheetCount: blockingIds.size,
      blockingSheetIds: [...blockingIds],
      /** True when any registered blocking sheet is active (premium, lifecycle modals, etc.). */
      isBlockingSheetActive: blockingIds.size > 0,
    }),
    [blockingIds, registerBlockingSheet, unregisterBlockingSheet],
  );

  return (
    <ModalSheetCoordinatorContext.Provider value={value}>{children}</ModalSheetCoordinatorContext.Provider>
  );
}

export function useModalSheetCoordinator() {
  const ctx = useContext(ModalSheetCoordinatorContext);
  if (!ctx) {
    throw new Error('useModalSheetCoordinator must be used within ModalSheetCoordinatorProvider');
  }
  return ctx;
}

/**
 * Register / unregister a blocking sheet when `active` toggles.
 */
export function useRegisterBlockingSheet(id, active) {
  const { registerBlockingSheet, unregisterBlockingSheet } = useModalSheetCoordinator();

  useEffect(() => {
    if (!active || !id) return undefined;
    registerBlockingSheet(id);
    return () => unregisterBlockingSheet(id);
  }, [active, id, registerBlockingSheet, unregisterBlockingSheet]);
}
