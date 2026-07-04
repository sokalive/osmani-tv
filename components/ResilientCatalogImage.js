import React, { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { resolveUploadImageCdnFallback } from '../lib/mediaDelivery';

/**
 * Catalog thumbnail/banner image — VPS `/uploads/` primary with BunnyCDN fallback for legacy assets.
 */
export default function ResilientCatalogImage({
  uri,
  fallbackUri = null,
  style,
  contentFit = 'cover',
  transition = 120,
  optimizeFallback = null,
  onFinalError = null,
}) {
  const derivedFallback =
    fallbackUri ??
    (uri ? resolveUploadImageCdnFallback(uri, optimizeFallback ?? undefined) : null);
  const [activeUri, setActiveUri] = useState(uri);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    setActiveUri(uri);
    setTriedFallback(false);
  }, [uri]);

  if (!activeUri) return null;

  return (
    <Image
      source={{ uri: activeUri }}
      style={style}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={activeUri}
      onError={() => {
        if (!triedFallback && derivedFallback && derivedFallback !== activeUri) {
          setTriedFallback(true);
          setActiveUri(derivedFallback);
          return;
        }
        if (typeof onFinalError === 'function') onFinalError();
      }}
    />
  );
}
