# Device Control + Hamisha Kifurushi — App ↔ Backend Contract

**Version:** 2026-07-04-transfer-device-control  
**Authoritative API:** `https://api.osmanitv.com/api`  
**VPS backend commit (probe):** `0ef8cc5deadb69082be83a48f8862a18911b0c1b`

## Transfer endpoints (confirmed on VPS)

| Action | Method | Path | Auth |
|--------|--------|------|------|
| Request code | POST | `/transfer/request` | Public |
| Confirm/redeem | POST | `/transfer/confirm` | Public |
| Respond approve/reject | POST | `/transfer/respond` | **NOT DEPLOYED** |
| Admin force | POST | `/transfer/admin-force` | Admin |
| Admin force by phone | POST | `/transfer/admin-force-phone` | Admin |

### POST `/transfer/request` body (app sends)

```json
{
  "source_device_id": "<canonical identity.deviceId>",
  "payment_phone": "0712345678",
  "device_fingerprint": "<sha256>",
  "install_instance_id": "...",
  "package_android_id": "..."
}
```

**Response:** `{ ok, code, expires_at, transfer_mode, source_device_id }`  
**Errors:** 403 `TRANSFER_DAILY_LIMIT` / `TRANSFER_WEEKLY_LIMIT`, 429 `cooldown_active`

### POST `/transfer/confirm` body

```json
{
  "code": "TR-XXXXXX",
  "target_device_id": "<canonical identity.deviceId>",
  "device_fingerprint": "<sha256>"
}
```

**Current VPS behavior:** **Immediate activation** — `transferred: true`, no pending confirmation.  
**App:** trusts `POST /subscription/verify` after confirm; never marks active from confirm body alone.

## SSE events ( `/api/sync/stream` )

| Event | When | App action |
|-------|------|------------|
| `transfer_requested` | Code issued | **Do not** open KUBALI — status is `active` |
| `transfer_confirmation_required` | Future confirmation mode | Open `TransferConfirmModal` on source |
| `transfer_completed` | Confirm / force | Source: revoke + verify; Target: verify + unlock |
| `subscription_revoked` | Source after transfer | Authoritative reverify; admin_force: silent revoke |
| `transfer_rejected` | Admin revoked code | Clear pending UI |

**Not emitted today:** `transfer_approved`, `transfer_pending`

## Device Control settings (admin-only today)

`GET/PUT /api/settings/device-control` — requires admin auth.

| Setting | Enforced by | App UX |
|---------|-------------|--------|
| `transferMode` | Backend (stored; confirm is immediate today) | Shown in request response only |
| `dailyLimit` / `weeklyLimit` | Backend 403 | Swahili error via `formatTransferRequestUserMessage` |
| `cooldownMinutes` | Backend 429 | Swahili cooldown message |
| `phoneGateEnabled` | Separate phone gate | Existing `PhoneNumberGate` |

**Backend AI TODO:** Public read-only settings endpoint OR embed in `/transfer/request` errors (current).

## Unique device registration

**Canonical endpoint:** `POST /api/users-intelligence/register`  
**App module:** `api/usersIntelligence.js` → `registerDeviceIntelligence()`  
**Trigger:** `DeviceIntelligenceContext` on boot + foreground; User Center SSE refresh.

Payload includes `device_id`, `device_fingerprint`, `install_instance_id`, `app_version`, `first_seen` / `last_seen`.  
Backend UPSERT — repeated launches update `last_seen` only.

**Not used:** `POST /api/device-installations/register` (does not exist).

## Device ID source of truth

All paths use `getDeviceIdentity().deviceId` (= `subscriptionDeviceId`):

- Account COPY/display
- `/transfer/request` `source_device_id`
- `/transfer/confirm` `target_device_id`
- `/subscription/verify`
- `/api/subscription-stream?device_id=`
- Users Intelligence register

## App convergence strategy

1. **Primary:** SSE `transfer_completed` / `subscription_revoked`
2. **Secondary:** Immediate `reverifySubscription()` on SSE wake
3. **Fallback:** Bounded verify poll (6s interval, max 30 source / 24 target) while transfer UI active

## Backend AI handoff — required for FULL PASS

1. Implement `POST /transfer/respond` when `transfer_mode=confirmation`
2. Emit `transfer_confirmation_required` when target redeems in confirmation mode
3. Optional: `GET /api/transfer/settings` public read for App UX mirrors
4. Document in `docs/cross-ai/device-control-transfer-contract.json`
