import React, { useMemo } from 'react';
import { resolveAvatar } from '../lib/avatar';

export default function ProfileAvatar({ seed = '', size = 64 }) {
  const a = useMemo(() => resolveAvatar(seed), [seed]);
  const [c1, c2] = a.bg;
  const hair = a.presentation.hair;
  const r = size / 2;

  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(145deg, ${c1}, ${c2})`,
      }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 64 64">
        <circle cx="32" cy="70" r="22" fill={a.shirt} />
        {(hair === 'long' || hair === 'bob') && (
          <ellipse cx="32" cy="40" rx="20" ry="22" fill={a.hair} />
        )}
        <ellipse cx="32" cy="30" rx="16" ry="18" fill={a.skin} />
        {hair !== 'bald' && (
          <path
            d={
              hair === 'bun'
                ? 'M18 22 C20 8 44 8 46 22 L44 26 C40 16 24 16 20 26 Z'
                : hair === 'side'
                  ? 'M16 24 C22 10 48 12 48 26 L46 28 C40 18 24 16 18 28 Z'
                  : 'M16 26 C20 10 44 10 48 26 L46 28 C40 16 24 16 18 28 Z'
            }
            fill={a.hair}
          />
        )}
        {hair === 'bun' && <circle cx="32" cy="10" r="6" fill={a.hair} />}
        <circle cx="25" cy="30" r="2.2" fill="#fff" />
        <circle cx="39" cy="30" r="2.2" fill="#fff" />
        <circle cx="25.3" cy="30.2" r="1.1" fill={a.eye} />
        <circle cx="39.3" cy="30.2" r="1.1" fill={a.eye} />
        {a.blush && (
          <>
            <ellipse cx="22" cy="36" rx="3" ry="1.6" fill="rgba(244,114,182,0.45)" />
            <ellipse cx="42" cy="36" rx="3" ry="1.6" fill="rgba(244,114,182,0.45)" />
          </>
        )}
        <path d="M27 41 Q32 45 37 41" stroke="#9F1239" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
