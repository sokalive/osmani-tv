# OTA Debug Mode

Temporary developer surface for inspecting the OTA update flow from three
places at once: the mobile app, the browser/domain, and the terminal.

## What you get

- Mobile app: a hidden full-screen debug overlay that shows decision,
  source, APK URL, Play Store URL, SSE status, overlay visibility, native
  module detection, last update-check timestamp, the latest backend
  payload, and the latest `/api/update-debug` snapshot. Activated by **7
  taps within 2 seconds on the "Osmani TV" home title** (no visible UI
  change). Pull-down close button. Auto-refreshes every 4 s.

- Browser/domain: `GET /api/update-debug` returns a JSON snapshot of the
  backend's view (current settings, current decision, SSE status, latest
  payload, latest client check, active clients count, recent checks).

- Terminal: structured `[update]` and `[update-debug]` logs on both sides
  with consistent tags (see "Tags" below) so you can grep the live flow.

## Files

| File | Purpose |
| --- | --- |
| `lib/updateClient.js` | Mobile OTA orchestrator. Adds tagged logs and `getDebugSnapshot()` / `subscribeDebug()` exporters. |
| `components/OtaDebugOverlay.js` | Mobile debug UI. Exports `OtaDebugTitleTap` (invisible 7-tap wrapper) + the overlay itself. |
| `App.js` | Wraps the title with `OtaDebugTitleTap` and mounts `<OtaDebugOverlay />`. |
| `backend/routes/updateDebug.js` | **Drop-in for the real `osmani-admin-api` repo.** Factory that exposes `attach(app)` plus `recordCheck()` and `recordSettingsSave()` hooks. |
| `backend/dev-update-debug-server.js` | **Standalone local dev server.** NOT registered in `backend/server.js`. Run with `node backend/dev-update-debug-server.js`. |

## Tags written to the terminal

Mobile (`[update]` prefix):

- `[OTA_INIT]` — client started
- `[CHECK_REQ]` — request fired
- `[CHECK_RESP]` — response (or `[CHECK_RESP] failed`)
- `[SSE_CONNECTING]`, `[SSE_CONNECTED]`, `[SSE_EVENT]`, `[SSE_DISCONNECTED]`
- `[NONE]`, `[SOFT]`, `[FORCE]`, `[PLAY_STORE]` — decision detection
- `[OVERLAY]` — overlay state changed
- `[NATIVE_STATE]`, `[DOWNLOAD]`, `[INSTALL]` — install lifecycle
- `[DEBUG_OVERLAY]` — debug overlay activated
- `[DEBUG_FETCH]` — debug overlay fetched `/api/update-debug`

Backend (`[update-debug]` prefix):

- `[CHECK_REQ]` — incoming `/api/update-check` (only emitted by the dev server)
- `[CHECK_EXECUTED]` — `recordCheck()` invoked from the real check handler
- `[ADMIN_SAVE]` — `recordSettingsSave()` invoked from the admin save handler
- `[CLIENT_CONNECTED]` / `[CLIENT_DISCONNECTED]` — SSE client lifecycle
- `[SSE_BROADCAST]` — SSE event sent

## Local end-to-end run

1. **Start the dev debug backend:**
   ```pwsh
   cd backend
   node dev-update-debug-server.js
   ```
   It listens on `http://0.0.0.0:4001` and prints `[update-debug] [SERVER_READY]`.

2. **Point the mobile app at it.** From the project root:
   ```pwsh
   $env:EXPO_PUBLIC_API_URL = "http://10.0.2.2:4001"   # Android emulator
   # or your LAN IP for a physical device, e.g. http://192.168.1.42:4001
   npx expo start -c
   ```

3. **Trigger the debug overlay in the app** — tap the "Osmani TV" title 7
   times in under 2 seconds. The overlay opens and starts polling
   `/api/update-debug` every 4 seconds.

4. **Drive the decision from the terminal:**
   ```pwsh
   $body = @{
     decision        = "FORCE"
     source          = "apk"
     apk_url         = "https://example.com/osmanitv.apk"
     apk_sha256      = ""
     auto_download   = $true
     latest_version_name = "1.2.3"
     latest_version_code = 23
     notice          = "Test FORCE update"
   } | ConvertTo-Json
   Invoke-RestMethod -Method POST -Uri http://localhost:4001/api/admin/update-settings -Body $body -ContentType "application/json"
   ```
   The dev server logs `[ADMIN_SAVE]` and `[SSE_BROADCAST]`. The mobile
   client receives `app_version_changed` over SSE, fires `[CHECK_REQ]`,
   gets `[CHECK_RESP]`, logs `[FORCE]`, mounts the overlay
   (`[OVERLAY] visible: true`), and the debug overlay's `/api/update-debug`
   panel updates within 4 s.

5. **Verify in the browser** — open `http://localhost:4001/api/update-debug`.

## Production handoff (real osmani-admin-api repo)

Copy `backend/routes/updateDebug.js` into the deployed `osmani-admin-api`
repository (path can stay the same), then in your existing `server.js`:

```js
const createUpdateDebug = require('./routes/updateDebug');
const updateDebug = createUpdateDebug();
updateDebug.attach(app);

// Inside your existing /api/update-check handler:
//   const payload = computeUpdatePayload(req);
//   updateDebug.recordCheck(req, payload);
//   return res.json(payload);

// Inside your admin "save update settings" handler:
//   await db.saveUpdateSettings(next);
//   updateDebug.recordSettingsSave(next);
```

Once deployed, `https://osmani-admin-api.onrender.com/api/update-debug`
becomes the browser-visible source of truth, and the mobile debug overlay
starts pulling live data from it without any further app change.

## Removing the debug surface later

When you no longer need this:

- Delete `components/OtaDebugOverlay.js`
- Remove the `OtaDebugTitleTap` wrapper and `<OtaDebugOverlay />` mount in `App.js`
- Remove `subscribeDebug` and `getDebugSnapshot` from `lib/updateClient.js`
  (or just leave them — they have no runtime cost when nobody subscribes)
- Detach the routes in your admin-api repo

The existing user-facing UI is untouched the entire time.
