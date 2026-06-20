import React, { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Mount children only after the first frame so Home can render with cached data.
 * @param {{ children: React.ReactNode; delayMs?: number }} props
 */
export default function DeferredMount({ children, delayMs = 0 }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const finish = () => {
      if (!cancelled) setReady(true);
    };

    const handle = InteractionManager.runAfterInteractions(() => {
      if (delayMs > 0) {
        timer = setTimeout(finish, delayMs);
      } else {
        finish();
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (handle && typeof handle.cancel === 'function') handle.cancel();
    };
  }, [delayMs]);

  if (!ready) return null;
  return children;
}
