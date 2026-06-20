import React, { useEffect, useState } from 'react';

/**
 * Mount children on the next frame — does not wait for InteractionManager.
 * @param {{ children: React.ReactNode; delayMs?: number }} props
 */
export default function DeferredMount({ children, delayMs = 16 }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const finish = () => {
      if (!cancelled) setReady(true);
    };

    timer = setTimeout(finish, Math.max(0, delayMs));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  if (!ready) return null;
  return children;
}
