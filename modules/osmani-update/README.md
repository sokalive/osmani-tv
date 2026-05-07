# osmani-update

Native Android self-update module for the Osmani TV app. Lives in
`modules/osmani-update/` and is auto-discovered by Expo Modules
Autolinking — no manual linking required.

## Files

| File                                          | Responsibility                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `android/.../UpdateManager.kt`                | Expo Module entry point; orchestrates check → download → verify → install   |
| `android/.../UpdateApi.kt`                    | HTTPS GET to the admin OTA endpoint; parses snake_case/camelCase responses  |
| `android/.../ApkDownloader.kt`                | Streams APK into app cache with progress callbacks; cancellation-aware      |
| `android/.../HashVerifier.kt`                 | SHA-256 with constant-time hex comparison                                   |
| `android/.../ApkInstaller.kt`                 | FileProvider URI + `ACTION_VIEW` package-archive intent; quitApp helper     |
| `android/src/main/AndroidManifest.xml`        | `REQUEST_INSTALL_PACKAGES` + FileProvider declaration                       |
| `android/src/main/res/xml/osmani_update_paths.xml` | FileProvider path mapping (`cacheDir/osmani_update`)                  |
| `index.ts`                                    | TypeScript bridge consumed from `lib/updateClient.js`                       |

## Backend contract

### `GET /api/update-check`

Query parameters:

- `platform=android`
- `package=com.osmantv.app`
- `version_code=<int>` — currently installed `versionCode`
- `version_name=<x.y.z>` — currently installed `versionName`
- `device_id=<uuid>` — optional, used for canary / staged rollout

Response (200, `application/json`). Snake_case fields are canonical;
camelCase aliases are accepted for compatibility.

```json
{
  "decision": "NONE | SOFT | FORCE | PLAY_STORE",
  "latest_version_code": 23,
  "latest_version_name": "1.2.3",
  "min_supported_version_code": 20,
  "auto_download": true,
  "apk_url": "https://cdn.osmani.tv/builds/osmanitv-1.2.3.apk",
  "apk_sha256": "abcd…64-hex…",
  "apk_size_bytes": 12345678,
  "play_store_url": "https://play.google.com/store/apps/details?id=com.osmantv.app",
  "playstore_url": "https://play.google.com/store/apps/details?id=com.osmantv.app",
  "release_notes": "Markdown or plaintext",
  "notice": "Short user-facing update message",
  "source": "apk | play | notice"
}
```

`apk_sha256` is optional in the current production backend. If it is
blank/missing, the app still allows HTTPS APK downloads and skips local
SHA verification. If a hash is provided, it remains a hard install gate.

### Realtime: `GET /api/sync/stream` (Server-Sent Events)

The mobile app subscribes via `react-native-sse`. Whenever the admin
changes `app_settings` / `app_version` rows, the backend publishes
either of these events:

```
event: app_version_changed
data: {"version_code":23,"version_name":"1.2.3"}

event: app_settings_changed
data: {"changed":["force_update","auto_download"]}
```

The mobile client treats both as a "re-check immediately" signal — no
state from the SSE payload is trusted directly. The next authoritative
state comes from `/api/update-check`.

## Decision semantics

| Decision     | App behavior                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `NONE`       | App is current; nothing happens.                                                                      |
| `SOFT`       | Dismissable overlay. If `auto_download=true`, download starts automatically; user accepts to install. |
| `FORCE`      | Blocking overlay. No skip button. Download (auto or manual). Cancel calls `finishAffinity()`.         |
| `PLAY_STORE` | Open Play Store deep link instead of downloading APK directly.                                        |

## Security guarantees

- **HTTPS only** — `ApkDownloader` rejects any non-HTTPS APK URL at runtime.
  Backend decisions are still rendered even when they are notice-only or
  Play-Store-only.
- **Optional SHA-256 verification before install** — when the backend provides
  `apk_sha256`, `HashVerifier` does a constant-time, length-strict,
  case-insensitive hex compare. Mismatches yield `hash_mismatch` and the
  staged APK is deleted. When the backend leaves the hash blank, verification
  is skipped by design.
- **Single-APK cache** — old downloads are wiped before each new one.
- **No silent install** — install always requires an explicit user tap
  in the system installer UI; this module never claims signature-level
  privileges.
