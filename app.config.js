const fs = require('fs');
const path = require('path');

const easProfile = process.env.EAS_BUILD_PROFILE || '';
const oneSignalMode = easProfile === 'production' ? 'production' : 'development';

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

module.exports = {
  expo: {
    name: 'Osmani TV',
    slug: 'osmani-tv',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'osmani',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
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
      icon: './assets/icon.png',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: 'com.burudanitv.app',
      usesCleartextTraffic: true,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      eas: {
        projectId: 'adf835d4-ad5d-425d-9e5b-de9a803066e0',
      },
      oneSignalAppId,
    },
    plugins: [
      [
        'onesignal-expo-plugin',
        {
          mode: oneSignalMode,
        },
      ],
      'expo-video',
      './plugins/withOsmaniUpdate.js',
    ],
  },
};
