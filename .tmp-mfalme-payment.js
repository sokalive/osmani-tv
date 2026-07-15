import { getApiBaseUrl } from '../api';
impor
t { parseCheckoutProvidersResponse } from '..
/lib/checkoutPaymentProviders';
import { reso
lveMediaAssetUrl } from '../lib/mediaDelivery
';

function paymentApiRoot() {
  return `${g
etApiBaseUrl()}/api`;
}

async function readJ
son(res) {
  try {
    return await res.json(
);
  } catch {
    return null;
  }
}

functi
on pickOrderId(body) {
  if (!body || typeof 
body !== 'object') return null;
  const v =
 
   body.order_id ??
    body.orderId ??
    b
ody.data?.order_id ??
    body.data?.orderId 
??
    body.transaction?.order_id;
  return v
 != null && String(v).trim() !== '' ? String(
v).trim() : null;
}

function isPlainObject(x
) {
  return x != null && typeof x === 'objec
t' && !Array.isArray(x);
}

/** Normalize API
 truthiness (avoids missing nested `data` vs 
root `active`). */
function parseSubscription
Active(value) {
  if (value === true || value
 === 1) return true;
  if (value === false ||
 value === 0) return false;
  if (typeof valu
e === 'string') {
    const s = value.trim().
toLowerCase();
    if (s === 'true' || s === 
'1' || s === 'yes' || s === 'active' || s ===
 'paid') return true;
    if (s === 'false' |
| s === '0' || s === 'no' || s === 'inactive'
 || s === '') return false;
  }
  return Bool
ean(value);
}

function pickSubscription(body
) {
  if (!isPlainObject(body)) return { acti
ve: false, expiresAt: null };
  const data = 
isPlainObject(body.data) ? body.data : null;

  const subNest = isPlainObject(body.subscrip
tion) ? body.subscription : null;
  const obj
 = subNest ?? data ?? body;
  const rawActive
 =
    body.active ??
    body.is_active ??
 
   body.isActive ??
    body.has_subscription
 ??
    body.subscribed ??
    data?.active ?
?
    data?.is_active ??
    data?.isActive ?
?
    subNest?.active ??
    subNest?.is_acti
ve ??
    subNest?.isActive ??
    obj.active
 ??
    obj.is_active ??
    obj.isActive;
  
let active = parseSubscriptionActive(rawActiv
e);
  if (!active) {
    const st = String(bo
dy.status ?? obj.status ?? data?.status ?? ''
).toLowerCase();
    if (['active', 'paid', '
success', 'live', 'ok'].includes(st)) active 
= true;
  }
  const expiresAt =
    body.expi
res_at ??
    body.expiresAt ??
    data?.exp
ires_at ??
    data?.expiresAt ??
    subNest
?.expires_at ??
    subNest?.expiresAt ??
   
 obj.expires_at ??
    obj.expiresAt ??
    o
bj.end_date ??
    obj.ends_at ??
    null;
 
 const exp = expiresAt != null ? String(expir
esAt) : null;
  return { active, expiresAt: e
xp };
}

function isExpiryValid(expiresAt) {

  if (!expiresAt) return false;
  const t = D
ate.parse(String(expiresAt));
  return Number
.isFinite(t) && t > Date.now();
}

/**
 * @re
turns {Promise<unknown[]>}
 */
export async f
unction getPlans() {
  const res = await fetc
h(`${paymentApiRoot()}/plans`);
  const body 
= await readJson(res);
  if (!res.ok) {
    c
onst msg = body?.error != null ? String(body.
error) : `HTTP ${res.status}`;
    throw new 
Error(msg || 'Could not load plans');
  }
  i
f (Array.isArray(body)) return body;
  if (bo
dy && Array.isArray(body.plans)) return body.
plans;
  if (body && Array.isArray(body.data)
) return body.data;
  throw new Error('Invali
d plans response');
}

function pickProviderL
ogoUrl(raw) {
  const candidates = [
    raw?
.logoUrl,
    raw?.logo_url,
    raw?.logoURL
,
    raw?.logo,
    raw?.image,
    raw?.ima
ge_url,
    raw?.imageUrl,
  ];
  for (const 
c of candidates) {
    if (typeof c === 'stri
ng') {
      const v = c.trim();
      if (v 
!== '') return v;
    }
  }
  return null;
}


function pickProviderActive(raw) {
  const c
andidates = [raw?.active, raw?.is_active, raw
?.isActive, raw?.enabled];
  for (const c of 
candidates) {
    if (c === false || c === 0 
|| c === 'false' || c === '0') return false;

    if (c === true || c === 1 || c === 'true'
 || c === '1') return true;
  }
  return true
;
}

function normalizeProviderRow(raw) {
  i
f (!raw || typeof raw !== 'object') return nu
ll;
  const name = String(raw.name ?? raw.tit
le ?? raw.label ?? '').trim();
  if (!name) r
eturn null;
  const id = String(raw.id ?? raw
.provider_id ?? raw.code ?? raw.slug ?? name)

    .trim()
    .toLowerCase()
    .replace(
/[^a-z0-9_-]+/g, '-');
  const logo = pickPro
viderLogoUrl(raw);
  return {
    id: id || n
ame.toLowerCase(),
    name,
    logoUrl: log
o ? resolveMediaAssetUrl(logo) : null,
    ac
tive: pickProviderActive(raw),
  };
}

/**
 *
 Live payment providers (admin-managed). Fall
s back to caller's local
 * defaults when the
 endpoint is unreachable or returns nothing.

 *
 * GET /api/payment-providers → []|{ pro
viders: [] }|{ data: [] }
 *
 * @returns {Pro
mise<{ id: string; name: string; logoUrl: str
ing|null; active: boolean }[]>}
 */
export as
ync function getPaymentProviders() {
  const 
res = await fetch(`${paymentApiRoot()}/paymen
t-providers`);
  const body = await readJson(
res);
  if (!res.ok) {
    const msg = body?.
error != null ? String(body.error) : `HTTP ${
res.status}`;
    throw new Error(msg || 'Cou
ld not load providers');
  }
  let raw = [];

  if (Array.isArray(body)) raw = body;
  else
 if (body && Array.isArray(body.providers)) r
aw = body.providers;
  else if (body && Array
.isArray(body.data)) raw = body.data;
  retur
n raw
    .map(normalizeProviderRow)
    .fil
ter((p) => p && p.active === true);
}

/**
 *
 Active checkout gateway from admin (zenopay 
| sonicpesa | auraxpay).
 * GET /api/payments
/checkout-providers
 */
export async function
 getCheckoutPaymentProviders() {
  const res 
= await fetch(`${paymentApiRoot()}/payments/c
heckout-providers`);
  const body = await rea
dJson(res);
  if (!res.ok) {
    const msg = 
body?.error != null ? String(body.error) : `H
TTP ${res.status}`;
    throw new Error(msg |
| 'Could not load checkout provider');
  }
  
return parseCheckoutProvidersResponse(body);

}

function extractPaymentErrorMessage(body, 
httpStatus) {
  if (!body || typeof body !== 
'object') {
    return httpStatus ? `HTTP ${h
ttpStatus}` : 'Payment could not be started';

  }
  const nested =
    body.details?.messa
ge ??
    body.details?.data?.message ??
    
body.sonicpesa?.message ??
    body.auraxpay?
.message;
  if (nested != null && String(nest
ed).trim() !== '') return String(nested).trim
();
  if (body.error != null && String(body.e
rror).trim() !== '') return String(body.error
).trim();
  if (body.message != null && Strin
g(body.message).trim() !== '') return String(
body.message).trim();
  return httpStatus ? `
HTTP ${httpStatus}` : 'Payment could not be s
tarted';
}

function buildCheckoutOrderBody(p
ayload) {
  const body = {
    phone: payload
.phone,
    plan_id: payload.plan_id,
    amo
unt: payload.amount,
    device_id: payload.d
evice_id,
  };
  if (payload.device_fingerpri
nt != null && String(payload.device_fingerpri
nt).trim() !== '') {
    body.device_fingerpr
int = String(payload.device_fingerprint).trim
();
  }
  const buyerName = payload.buyer_nam
e ?? payload.buyerName;
  if (buyerName != nu
ll && String(buyerName).trim() !== '') {
    
body.buyer_name = String(buyerName).trim();
 
 }
  const buyerEmail = payload.buyer_email ?
? payload.buyerEmail;
  if (buyerEmail != nul
l && String(buyerEmail).trim() !== '') {
    
body.buyer_email = String(buyerEmail).trim();

  }
  return body;
}

async function postCre
ateOrder(url, payload, errorLabel) {
  const 
requestBody = buildCheckoutOrderBody(payload)
;
  const res = await fetch(url, {
    method
: 'POST',
    headers: { 'Content-Type': 'app
lication/json' },
    body: JSON.stringify(re
questBody),
  });
  const body = await readJs
on(res);
  if (!res.ok) {
    const msg = ext
ractPaymentErrorMessage(body, res.status);
  
  throw new Error(msg || `${errorLabel} could
 not be started`);
  }
  const orderId = pick
OrderId(body);
  if (!orderId) throw new Erro
r('Missing order_id from server');
  const ex
piresInSeconds = Number(body.expires_in_secon
ds ?? body.expiresIn ?? body.timeout_seconds)
;
  return {
    order_id: orderId,
    expir
esInSeconds: Number.isFinite(expiresInSeconds
) ? expiresInSeconds : undefined,
  };
}

/**

 * SonicPesa STK — POST /api/payments/soni
cpesa/create-order
 * @param {{ phone: string
; plan_id: string; amount: number; device_id:
 string; device_fingerprint?: string }} paylo
ad
 * @returns {Promise<{ order_id: string; e
xpiresInSeconds?: number }>}
 */
export async
 function createSonicpesaOrder(payload) {
  r
eturn postCreateOrder(`${paymentApiRoot()}/pa
yments/sonicpesa/create-order`, payload, 'Son
icPesa payment');
}

/**
 * Aurax Pay STK —
 POST /api/payments/auraxpay/create-order
 * 
@param {{ phone: string; plan_id: string; amo
unt: number; device_id: string; device_finger
print?: string }} payload
 * @returns {Promis
e<{ order_id: string; expiresInSeconds?: numb
er }>}
 */
export async function createAuraxp
ayOrder(payload) {
  return postCreateOrder(`
${paymentApiRoot()}/payments/auraxpay/create-
order`, payload, 'Aurax Pay payment');
}

/**

 * @param {'zenopay'|'sonicpesa'|'auraxpay'}
 provider
 */
export function resolveCheckout
StartPayment(provider) {
  if (provider === '
sonicpesa') return createSonicpesaOrder;
  if
 (provider === 'auraxpay') return createAurax
payOrder;
  return createPayment;
}

/**
 * @
param {{ phone: string; plan_id: string; amou
nt: number; device_id: string; device_fingerp
rint: string }} payload
 * @returns {Promise<
{ order_id: string; expiresInSeconds?: number
 }>}
 */
export async function createPayment(
payload) {
  const url = `${paymentApiRoot()}
/payments/create-payment`;
  const requestBod
y = JSON.stringify(payload);

  if (__DEV__) 
{
    console.log('[createPayment] API base (
from api.js):', getApiBaseUrl());
    console
.log('[createPayment] Full URL:', url);
    c
onsole.log('[createPayment] Request body:', r
equestBody);
  }

  let res;
  let responseTe
xt = '';
  try {
    res = await fetch(url, {

      method: 'POST',
      headers: { 'Cont
ent-Type': 'application/json' },
      body: 
requestBody,
    });
    responseText = await
 res.text();
  } catch (error) {
    if (__DE
V__) console.log('[createPayment] FETCH ERROR
:', String(error));
    throw error;
  }

  i
f (__DEV__) {
    console.log('[createPayment
] Response status:', res.status, res.statusTe
xt);
    console.log('[createPayment] Respons
e text:', responseText);
  }

  let body = nu
ll;
  if (responseText) {
    try {
      bod
y = JSON.parse(responseText);
    } catch {
 
     body = null;
    }
  }

  if (!res.ok) {

    const msg =
      body?.error != null
  
      ? String(body.error)
        : body?.me
ssage != null
          ? String(body.message
)
          : `HTTP ${res.status}`;
    throw
 new Error(msg || 'Payment could not be start
ed');
  }
  const orderId = pickOrderId(body)
;
  if (!orderId) throw new Error('Missing or
der_id from server');
  const expiresInSecond
s = Number(body.expires_in_seconds ?? body.ex
piresIn ?? body.timeout_seconds);
  return {

    order_id: orderId,
    expiresInSeconds: 
Number.isFinite(expiresInSeconds) ? expiresIn
Seconds : undefined,
  };
}

/**
 * Poll afte
r create-payment. Backend: GET /api/payment-s
tatus/:orderId
 * @param {string} orderId
 * 
@returns {Promise<{ status: 'SUCCESS' | 'FAIL
ED' | 'PENDING'; reason: string }>}
 */
expor
t async function getPaymentStatus(orderId) {

  const q = encodeURIComponent(orderId);
  co
nst res = await fetch(`${paymentApiRoot()}/pa
yment-status/${q}`);
  const body = await rea
dJson(res);
  if (!res.ok) {
    if (res.stat
us === 404) {
      return {
        status: 
'FAILED',
        reason: String(body?.reason
 ?? body?.error ?? 'Order not found'),
      
};
    }
    const msg = body?.error != null 
? String(body.error) : `HTTP ${res.status}`;

    throw new Error(msg || 'Could not check p
ayment status');
  }
  const st = String(body
?.status ?? 'PENDING').toUpperCase();
  const
 reason = String(body?.reason ?? '');
  if (s
t === 'SUCCESS') return { status: 'SUCCESS', 
reason };
  if (st === 'FAILED') return { sta
tus: 'FAILED', reason };
  return { status: '
PENDING', reason };
}

/**
 * @param {string}
 orderId
 * @returns {Promise<{ status: strin
g; reason: string }>}
 */
export async functi
on getTransactionStatus(orderId) {
  const r 
= await getPaymentStatus(orderId);
  if (r.st
atus === 'SUCCESS') return { status: 'COMPLET
ED', reason: r.reason };
  if (r.status === '
FAILED') return { status: 'FAILED', reason: r
.reason };
  return { status: 'PENDING', reas
on: r.reason };
}

/**
 * @param {string} dev
iceId
 */
export async function fetchSubscrip
tion(deviceId) {
  const url = `${paymentApiR
oot()}/subscription-status?device_id=${encode
URIComponent(deviceId)}`;
  const res = await
 fetch(url);
  const body = await readJson(re
s);
  if (!res.ok) {
    if (res.status === 4
04) return { active: false, expiresAt: null }
;
    const msg = body?.error != null ? Strin
g(body.error) : `HTTP ${res.status}`;
    thr
ow new Error(msg || 'Could not load subscript
ion');
  }
  return pickSubscription(body);
}


/**
 * Verify subscription is active (e.g. 
before playback).
 * @param {string} deviceId

 */
export async function verifySubscription
Active(deviceId) {
  const sub = await fetchS
ubscription(deviceId).catch(() => ({
    acti
ve: false,
    expiresAt: null,
  }));
  if (
sub.active !== true) return false;
  return i
sExpiryValid(sub.expiresAt);
}



