const fs = require('fs');
const path = require('path');

const easProfile = process.env.EAS_BUILD_PROFILE || '';
const oneSignalMode = easProfile === 'production' ? 'production' : 'development';

const googleJsonPath = path.join(__dirname, 'google-services.json');
const googleServicesFile = fs.existsSync(googleJsonPath) ? './google-services.json' : undefined;

if (!googleServicesFile) {
  console.warn(
    '[app.config] Missing ./google-services.json — add the Firebase Android file (package com.burudanitv.app) at the project root before EAS Android production builds so FCM works with OneSignal.',
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
