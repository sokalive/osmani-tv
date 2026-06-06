/**
 * Admin API helper: rewrite Render media URLs to BunnyCDN in JSON responses.
 * Set PUBLIC_MEDIA_CDN_BASE on the Admin API service (default below).
 */

const DEFAULT_MEDIA_CDN_BASE = "https://osmanitv.b-cdn.net";

const LEGACY_MEDIA_HOSTS = [
  "osmani-admin-api.onrender.com",
  "osmani-tv.onrender.com",
];

function mediaCdnBase() {
  const raw = process.env.PUBLIC_MEDIA_CDN_BASE || DEFAULT_MEDIA_CDN_BASE;
  return String(raw).replace(/\/+$/, "");
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ""));
}

function isStreamDirectUrl(input) {
  return /\/stream-direct(?:\?|$)/i.test(String(input ?? ""));
}

function rewriteLegacyRenderMediaUrl(input) {
  if (input == null) return input;
  const s = String(input).trim();
  if (!s) return s;

  if (isStreamDirectUrl(s)) {
    return s;
  }

  if (s.startsWith("/")) {
    return `${mediaCdnBase()}${s}`;
  }

  if (!/^https?:\/\//i.test(s)) {
    return `${mediaCdnBase()}/${s.replace(/^\/+/, "")}`;
  }

  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = LEGACY_MEDIA_HOSTS.some((h) => host === h.toLowerCase());
    if (!isLegacy) return s;
    const cdn = new URL(mediaCdnBase());
    u.protocol = cdn.protocol;
    u.host = cdn.host;
    return u.toString();
  } catch {
    return s;
  }
}

function looksLikeHlsManifestPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function buildCdnStreamProxyUrl(rawUrl, headers = {}) {
  if (!rawUrl || isStreamProxyUrl(rawUrl)) {
    return rewriteLegacyRenderMediaUrl(rawUrl);
  }
  const base = `${mediaCdnBase()}/stream-proxy`;
  const params = new URLSearchParams();
  params.set("url", String(rawUrl));
  if (headers.referer) params.set("referer", String(headers.referer));
  if (headers.origin) params.set("origin", String(headers.origin));
  if (headers.userAgent) params.set("ua", String(headers.userAgent));
  return `${base}?${params.toString()}`;
}

function normalizeStreamDeliveryMode(raw) {
  const m = String(raw ?? "").trim().toLowerCase();
  if (m === "direct") return "direct";
  if (m === "auto" || m === "hybrid") return "auto";
  return "proxy";
}

function enrichChannelForViewer(row) {
  if (!row || typeof row !== "object") return row;
  const out = rewriteMediaUrlsInJson(row);
  const rawUrl = String(out.url ?? out.stream_url ?? "").trim();
  const referer = String(out.referer ?? out.referrer ?? "").trim();
  const origin = String(out.origin ?? out.stream_origin ?? "").trim();
  const userAgent = String(out.userAgent ?? out.user_agent ?? "").trim();
  const headers = { referer, origin, userAgent };
  const deliveryMode = normalizeStreamDeliveryMode(
    out.stream_delivery_mode ?? out.streamDeliveryMode,
  );
  out.stream_delivery_mode = deliveryMode;
  out.streamDeliveryMode = deliveryMode;

  const directRaw = String(
    out.direct_stream_url ?? out.directStreamUrl ?? "",
  ).trim();
  if (directRaw) {
    const direct = isStreamDirectUrl(directRaw)
      ? directRaw
      : rewriteLegacyRenderMediaUrl(directRaw);
    out.direct_stream_url = direct;
    out.directStreamUrl = direct;
  }

  if (rawUrl && looksLikeHlsManifestPath(rawUrl)) {
    const proxyUrl = buildCdnStreamProxyUrl(rawUrl, headers);
    const playback = String(out.playbackUrl ?? out.playback_url ?? "").trim();
    if (!playback) {
      out.playbackUrl = proxyUrl;
      out.playback_url = out.playbackUrl;
    }
    out.proxy_fallback_url = out.playbackUrl || proxyUrl;
    out.proxyFallbackUrl = out.proxy_fallback_url;

    if (deliveryMode === "direct" && out.direct_stream_url) {
      out.playbackUrl = out.direct_stream_url;
      out.playback_url = out.playbackUrl;
    }
  }

  if (out.streamProxy && typeof out.streamProxy === "object") {
    const primary = out.streamProxy.primaryUrl ?? out.streamProxy.primary_url;
    if (primary) {
      const rewritten = rewriteLegacyRenderMediaUrl(primary);
      out.streamProxy.primaryUrl = rewritten;
      out.streamProxy.primary_url = rewritten;
    }
  }

  return out;
}

function rewriteMediaUrlsInJson(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return value;
    if (value.includes("/uploads/") || isStreamProxyUrl(value) || value.startsWith("/uploads/")) {
      return rewriteLegacyRenderMediaUrl(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteMediaUrlsInJson(item));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteMediaUrlsInJson(v);
    }
    return out;
  }
  return value;
}

module.exports = {
  DEFAULT_MEDIA_CDN_BASE,
  mediaCdnBase,
  isStreamProxyUrl,
  rewriteLegacyRenderMediaUrl,
  rewriteMediaUrlsInJson,
  enrichChannelForViewer,
  buildCdnStreamProxyUrl,
  enrichBannerForViewer: require("./bannerViewerSerializer").enrichBannerForViewer,
  enrichBannersForViewer: require("./bannerViewerSerializer").enrichBannersForViewer,
};
