# Osmani Link — reusable silent authorization

## Pattern for every current and future app

1. Register the app in Osmani Link Admin (name + package + validity).
2. Approve it and store **that app’s** Access Key in a private env/secret store.
3. Configure:
   - `EXPO_PUBLIC_OSMANI_LINK_APP_ID`
   - `EXPO_PUBLIC_OSMANI_LINK_ACCESS_KEY`
4. Keep `lib/osmaniLinkSilentAuth.js` and the `ChannelPlayerScreen` wiring.
5. Channel URLs stay `https://links.osmanlink.site/embed?channel=ID` (unchanged).

Never reuse another app’s credentials. Never commit Access Keys. Pending/rejected/expired/revoked apps remain denied by the server.

## Native WebView shell apps

Call authorize → set `CookieManager` for `https://links.osmanlink.site` → open the same public URL (see `BurudanTV` `OsmaniLinkSilentAuth.kt`).
