/**
 * Android 12+ splash: 288dp centered logo drawables + native SplashScreen theme attrs.
 * Must be listed BEFORE expo-splash-screen in app.config.js plugins (mod chain runs inner last).
 */
const { withAndroidStyles, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const {
  generateImageBackgroundAsync,
  generateImageAsync,
  compositeImagesAsync,
} = require('@expo/image-utils');

const SPLASH_THEME_PARENT = { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' };
const SPLASH_LOGO_WIDTH_DP = 288;
const SPLASH_CANVAS_DP = 288;
const SPLASH_BG = '#000000';

const DENSITY_BUCKETS = {
  mdpi: { folder: 'drawable-mdpi', multiplier: 1 },
  hdpi: { folder: 'drawable-hdpi', multiplier: 1.5 },
  xhdpi: { folder: 'drawable-xhdpi', multiplier: 2 },
  xxhdpi: { folder: 'drawable-xxhdpi', multiplier: 3 },
  xxxhdpi: { folder: 'drawable-xxxhdpi', multiplier: 4 },
};

function resolveSplashImagePath(config) {
  for (const entry of config.plugins ?? []) {
    if (Array.isArray(entry) && entry[0] === 'expo-splash-screen' && entry[1]) {
      return entry[1].android?.image ?? entry[1].image ?? './assets/splash-icon.png';
    }
  }
  return config.splash?.image ?? './assets/splash-icon.png';
}

async function writeLargeSplashDrawables(projectRoot, imageRelativePath) {
  const androidMain = path.join(projectRoot, 'android', 'app', 'src', 'main');
  const src = path.join(projectRoot, imageRelativePath.replace(/^\.\//, ''));

  if (!fs.existsSync(src)) {
    console.warn('[withAndroidLargeSplash] splash image missing:', src);
    return;
  }

  await Promise.all(
    Object.values(DENSITY_BUCKETS).map(async ({ folder, multiplier }) => {
      const logoPx = Math.round(SPLASH_LOGO_WIDTH_DP * multiplier);
      const canvasPx = Math.round(SPLASH_CANVAS_DP * multiplier);

      const background = await generateImageBackgroundAsync({
        width: canvasPx,
        height: canvasPx,
        backgroundColor: SPLASH_BG,
        resizeMode: 'cover',
      });

      const { source: foreground } = await generateImageAsync(
        { projectRoot, cacheType: 'splash-android-large' },
        {
          src: imageRelativePath,
          resizeMode: 'contain',
          width: logoPx,
          height: logoPx,
          backgroundColor: SPLASH_BG,
        },
      );

      const composed = await compositeImagesAsync({
        background,
        foreground,
        x: Math.round((canvasPx - logoPx) / 2),
        y: Math.round((canvasPx - logoPx) / 2),
      });

      const outDir = path.join(androidMain, 'res', folder);
      await fs.promises.mkdir(outDir, { recursive: true });
      await fs.promises.writeFile(path.join(outDir, 'splashscreen_logo.png'), composed);
    }),
  );
}

const withAndroidLargeSplash = (config) => {
  const splashImage = resolveSplashImagePath(config);

  config = withAndroidStyles(config, (cfg) => {
    let xml = cfg.modResults;
    xml = AndroidConfig.Styles.removeStylesItem({
      xml,
      parent: SPLASH_THEME_PARENT,
      name: 'android:windowSplashScreenBehavior',
    });
    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: SPLASH_THEME_PARENT,
      name: 'windowSplashScreenIconBackgroundColor',
      value: '@color/splashscreen_background',
    });
    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: SPLASH_THEME_PARENT,
      name: 'windowSplashScreenBackground',
      value: '@color/splashscreen_background',
    });
    xml = AndroidConfig.Styles.assignStylesValue(xml, {
      add: true,
      parent: SPLASH_THEME_PARENT,
      name: 'windowSplashScreenAnimatedIcon',
      value: '@drawable/splashscreen_logo',
    });
    cfg.modResults = xml;
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      await writeLargeSplashDrawables(cfg.modRequest.projectRoot, splashImage);
      return cfg;
    },
  ]);
};

module.exports = withAndroidLargeSplash;
