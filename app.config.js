const fs = require('fs');
const path = require('path');

const easProfile = process.env.EAS_BUILD_PROFILE || '';
const oneSignalMode = easProfile === 'production' ? 'production' : 'development';
const VPS_API_URL = 'https://api.osmanitv.com';
const RENDER_API_URL = 'https://osmani-admin-api.onrender.com';
/** Baked into native manifest — OTA fallback when EXPO_PUBLIC_API_URL missing from JS bundle. */
const manifestApiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim?.() ||
  (easProfile === 'production' || easProfile === 'vps-preview' ? VPS_API_URL : RENDER_API_URL);

const rootGooglePath = path.join(__dirname, 'google-services.json');

/**
 * Resolve Android `googleServicesFile` for Expo / EAS.
 *
 * 1) **Repo file** — commit `./google-services.json` (package must match `android.package`).
 * 2) **EAS file secret** — `eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`
 *    then link the variable to your build **environment** in Expo dashboard (or `eas.json` → `environment`).
 *    During the build, `GOOGLE_SERVICES_JSON` is a temp **file path**; we copy it into the project root.
 * 3) **Raw JSON env** (optional) — if `GOOGLE_SERVICES_JSON` is JSON text (not a path), it is written to `./google-services.json`.
 */
function resolveGoogleServicesFile() {
  if (fs.existsSync(rootGooglePath)) {
    return './google-services.json';
  }

  const fromEas = process.env.GOOGLE_SERVICES_JSON;
  if (fromEas && typeof fromEas === 'string') {
    const trimmed = fromEas.trim();
    if (trimmed.startsWith('{')) {
      try {
        JSON.parse(trimmed);
        fs.writeFileSync(rootGooglePath, trimmed, 'utf8');
        return './google-services.json';
      } catch (e) {
        console.warn('[app.config] GOOGLE_SERVICES_JSON is not valid JSON:', e?.message);
      }
    } else if (fs.existsSync(trimmed)) {
      try {
        fs.copyFileSync(trimmed, rootGooglePath);
        return './google-services.json';
      } catch (e) {
        console.warn('[app.config] Failed to copy GOOGLE_SERVICES_JSON file into project:', e?.message);
      }
    }
  }

  return undefined;
}

const googleServicesFile = resolveGoogleServicesFile();

/** Read ProGuard file content (extraProguardRules expects a string, not a path). */
function loadAndroidProguardRules() {
  const file = path.join(__dirname, 'android-proguard-rules.pro');
  try {
    if (!fs.existsSync(file)) {
      console.warn('[app.config] Missing android-proguard-rules.pro');
      return '';
    }
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    console.warn('[app.config] Failed to read android-proguard-rules.pro:', e?.message);
    return '';
  }
}

const androidProguardRules = loadAndroidProguardRules();

/** Canonical Expo brand paths — only these are embedded in native builds. */
const BRAND_ASSETS = {
  icon: './assets/icon.png',
  adaptiveIcon: './assets/adaptive-icon.png',
  splash: './assets/splash-icon.png',
  favicon: './assets/favicon.png',
};

function assertBrandAsset(relPath, label) {
  const abs = path.join(__dirname, relPath.replace(/^\.\//, ''));
  if (!fs.existsSync(abs)) {
    throw new Error(`[app.config] Missing ${label}: ${relPath}`);
  }
  return relPath;
}

function warnIfDuplicateBrandAssetsNewer() {
  const pairs = [
    ['assets/icon (2).png', BRAND_ASSETS.icon],
    ['assets/adaptive-icon (2).png', BRAND_ASSETS.adaptiveIcon],
  ];
  for (const [dupeRel, canonicalRel] of pairs) {
    const dupe = path.join(__dirname, dupeRel);
    const canonical = path.join(__dirname, canonicalRel.replace(/^\.\//, ''));
    if (!fs.existsSync(dupe) || !fs.existsSync(canonical)) continue;
    const dupeStat = fs.statSync(dupe);
    const canStat = fs.statSync(canonical);
    if (dupeStat.mtimeMs > canStat.mtimeMs + 1000 || dupeStat.size > canStat.size * 2) {
      console.warn(
        `[app.config] "${dupeRel}" is newer/larger than "${canonicalRel}". ` +
          'Expo embeds only canonical paths — run: npm run sync:brand-assets',
      );
    }
  }
}

for (const [key, rel] of Object.entries(BRAND_ASSETS)) {
  assertBrandAsset(rel, key);
}
warnIfDuplicateBrandAssetsNewer();

if (!googleServicesFile) {
  console.warn(
    '[app.config] Missing Android FCM config: add committed ./google-services.json or set GOOGLE_SERVICES_JSON (EAS file secret / JSON) for OneSignal + FCM on EAS builds.',
  );
}

const DEFAULT_ONESIGNAL_APP_ID = '6a3f9dc9-96e9-402a-90e9-9dd829b212b2';

const oneSignalAppId =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID?.trim?.() ||
  process.env.ONESIGNAL_APP_ID?.trim?.() ||
  DEFAULT_ONESIGNAL_APP_ID;

/** EAS project — required for Expo Updates (JS OTA). */
const EAS_PROJECT_ID = 'adf835d4-ad5d-425d-9e5b-de9a803066e0';
const EXPO_UPDATES_URL = `https://u.expo.dev/${EAS_PROJECT_ID}`;

module.exports = {
  expo: {
    name: 'Osmani TV',
    slug: 'osmani-tv',
    /** User-visible version (Android versionName / iOS CFBundleShortVersionString). */
    version: process.env.OTA_RUNTIME_TARGET?.trim() || '1.8.2',
    /**
     * EAS Update runtime — OTA bundles only apply when this matches the native build
     * (policy: appVersion → uses `version` above). Bump `version` + versionCode for native changes.
     */
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      enabled: true,
      url: EXPO_UPDATES_URL,
      /**
       * ON_LOAD: native layer checks for updates on every cold start so VPS
       * users receive popup-removal OTAs without reinstall / clear-data.
       * (Previously ON_ERROR_RECOVERY — updates only checked after crash loops.)
       */
      checkAutomatically: 'ON_LOAD',
      /** Wait up to 30s for an update on cold start before using the cached bundle. */
      fallbackToCacheTimeout: 30000,
    },
    orientation: 'portrait',
    icon: BRAND_ASSETS.icon,
    scheme: 'osmani',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: BRAND_ASSETS.splash,
      resizeMode: 'cover',
      backgroundColor: '#FFFFFF',
    },
    androidStatusBar: {
      backgroundColor: '#000000',
      barStyle: 'light-content',
      translucent: false,
    },
    ios: {
      bundleIdentifier: 'com.burudanitv.app',
      supportsTablet: true,
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
        UIBackgroundModes: ['remote-notification'],
      },
      entitlements: {
        'aps-environment': oneSignalMode,
        'com.apple.security.application-groups': ['group.com.burudanitv.app.onesignal'],
      },
    },
    android: {
      icon: BRAND_ASSETS.icon,
      adaptiveIcon: {
        foregroundImage: BRAND_ASSETS.adaptiveIcon,
        backgroundColor: '#000000',
      },
      /** Play Store VPS HTTPS release (v24). Legacy Render APKs keep prior native embeds. */
      versionCode: 24,
      /** Cold-start window color before React (pairs with native splash theme). */
      backgroundColor: '#FFFFFF',
      edgeToEdgeEnabled: true,
      package: 'com.burudanitv.app',
      /**
       * Strip gallery/storage permissions merged from legacy Expo/RN modules.
       * App only streams remote HLS/MP4 and loads remote banner/channel images (expo-image).
       */
      blockedPermissions: [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    web: {
      favicon: BRAND_ASSETS.favicon,
    },
    extra: {
      eas: {
        projectId: EAS_PROJECT_ID,
      },
      /** Native fallback for {@link lib/apiBaseUrl} when OTA JS omits EXPO_PUBLIC_API_URL. */
      apiBaseUrl: manifestApiBaseUrl,
      oneSignalAppId,
      /** EAS: set EXPO_PUBLIC_ONESIGNAL_STARTUP_LOGS=1 to log push id / permission / opt-in at startup (logcat). */
      oneSignalStartupLogs: process.env.EXPO_PUBLIC_ONESIGNAL_STARTUP_LOGS === '1',
      /** `enforce` | `warn` | `off` — preview builds default to warn via eas.json */
      securityEnforcement: process.env.EXPO_PUBLIC_SECURITY_ENFORCEMENT || 'enforce',
      /** Official Android applicationId — blocks repackaged clone package names. */
      expectedAndroidPackage:
        process.env.EXPO_PUBLIC_EXPECTED_ANDROID_PACKAGE?.trim?.() || 'com.burudanitv.app',
      /** Optional SHA-256 signing cert (hex, lowercase) for resign detection on Android */
      expectedSigningCertSha256:
        process.env.EXPO_PUBLIC_ANDROID_SIGNING_CERT_SHA256?.trim?.() || '',
      /** false when EXPO_PUBLIC_APK_INSTALLER_ENABLED=0 (Play Store builds). */
      apkInstallerEnabled: process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED !== '0',
    },
    plugins: [
      /** Register before expo-splash-screen so style mods run after Expo's (mod chain order). */
      './plugins/withAndroidLargeSplash.js',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#FFFFFF',
          image: BRAND_ASSETS.splash,
          resizeMode: 'cover',
          /** Expo Android canvas max (288dp) — largest centered logo for API 31+ splash. */
          imageWidth: 288,
          android: {
            backgroundColor: '#FFFFFF',
            image: BRAND_ASSETS.splash,
            resizeMode: 'cover',
            imageWidth: 288,
          },
          ios: {
            backgroundColor: '#FFFFFF',
            image: BRAND_ASSETS.splash,
            resizeMode: 'cover',
            imageWidth: 280,
          },
        },
      ],
      [
        'onesignal-expo-plugin',
        {
          mode: oneSignalMode,
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules: androidProguardRules,
          },
        },
      ],
      'expo-video',
      './plugins/withOsmaniUpdate.js',
      './plugins/withStripMediaPermissions.js',
      './plugins/withGlobalSecureScreen.js',
      'expo-updates',
    ],
  },
};
