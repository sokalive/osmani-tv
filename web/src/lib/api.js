import { API_BASE, MEDIA_CDN, STREAM_PROXY_BASE } from './theme';

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiGet(path, { cacheBust = false } = {}) {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  if (cacheBust) url.searchParams.set('_', String(Date.now()));
  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  const body = await parseJson(res);
  if (!res.ok) {
    const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function apiPost(path, payload) {
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await parseJson(res);
  if (!res.ok) {
    const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function resolveMediaUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/uploads/')) return `${API_BASE}${s}`;
  if (s.startsWith('/')) return `${MEDIA_CDN}${s}`;
  return `${API_BASE}/uploads/${s.replace(/^\/+/, '')}`;
}

export function buildProxyUrl(streamUrl) {
  const u = String(streamUrl || '').trim();
  if (!u) return '';
  if (u.includes('/stream-proxy')) return u;
  const params = new URLSearchParams();
  params.set('url', u);
  return `${STREAM_PROXY_BASE}?${params.toString()}`;
}

export function pickStreamUrl(channel) {
  if (!channel) return '';
  return (
    channel.proxy_playback_url ||
    channel.playbackUrl ||
    channel.streamUrl ||
    channel.stream_url ||
    channel.url ||
    channel.direct_stream_url ||
    ''
  );
}

export function channelThumbnail(channel) {
  return resolveMediaUrl(
    channel?.thumbnailUrl || channel?.thumbnail_url || channel?.thumbnail || '',
  );
}

export function isChannelVisible(ch) {
  const show =
    ch?.showInApp !== undefined
      ? Boolean(ch.showInApp)
      : ch?.show_in_app !== undefined
        ? Boolean(ch.show_in_app)
        : true;
  const active =
    ch?.isActive !== undefined
      ? Boolean(ch.isActive)
      : ch?.active !== undefined
        ? Boolean(ch.active)
        : ch?.is_active !== undefined
          ? Boolean(ch.is_active)
          : true;
  return show && active;
}

export function channelCategory(ch) {
  return String(ch?.category || ch?.genre || ch?.type || '').toLowerCase();
}

export function parseSubscription(body) {
  if (!body || typeof body !== 'object') {
    return { active: false, expiresAt: null, status: null, planName: null, remainingDays: null };
  }
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const obj = body.subscription && typeof body.subscription === 'object' ? body.subscription : data || body;
  const raw =
    body.active ?? body.isActive ?? body.is_active ?? obj.active ?? obj.isActive ?? obj.is_active;
  let active = raw === true || raw === 1 || String(raw).toLowerCase() === 'true';
  const st = String(body.status ?? obj.status ?? '').toLowerCase();
  if (!active && ['active', 'paid', 'success', 'live'].includes(st)) active = true;
  const expiresAt =
    body.expiresAt ?? body.expires_at ?? obj.expiresAt ?? obj.expires_at ?? null;
  const planName =
    body.planName ?? body.plan_name ?? obj.planName ?? obj.plan_name ?? obj.plan?.name ?? null;
  const remainingDays =
    body.remainingDays ?? body.remaining_days ?? obj.remainingDays ?? obj.remaining_days ?? null;
  return {
    active,
    expiresAt: expiresAt != null ? String(expiresAt) : null,
    status: body.status ?? obj.status ?? null,
    planName: planName != null ? String(planName) : null,
    remainingDays,
    price: body.price ?? obj.price ?? body.amount ?? obj.amount ?? null,
  };
}
