/**
 * Browser/React Native banner viewer serializer (mirrors backend/lib/bannerViewerSerializer.js).
 * Applied in getBanners() so clients normalize timer/countdown fields out of the payload.
 */

export { RED_BADGE, enrichBannerForViewer, enrichBannersForViewer } from './bannerViewerSerializer.shared.js';
