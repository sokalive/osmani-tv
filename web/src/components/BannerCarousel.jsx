import React, { useEffect, useState } from 'react';
import { resolveMediaUrl } from '../lib/api';

export default function BannerCarousel({ banners = [] }) {
  const [idx, setIdx] = useState(0);
  const list = banners.filter((b) => resolveMediaUrl(b.imageUrl || b.image_url || b.image));

  useEffect(() => {
    if (list.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 4500);
    return () => clearInterval(t);
  }, [list.length]);

  if (!list.length) return null;
  const b = list[idx % list.length];
  const src = resolveMediaUrl(b.imageUrl || b.image_url || b.image);

  return (
    <div className="banner-wrap">
      <img src={src} alt={b.title || 'Banner'} />
      <div className="banner-dots">
        {list.map((_, i) => (
          <span key={i} className={i === idx % list.length ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}
