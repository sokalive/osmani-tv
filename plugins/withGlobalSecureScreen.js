/**
 * Applies FLAG_SECURE on MainActivity at onCreate + onResume so protection
 * is active before React mounts and survives activity lifecycle transitions.
 */
const { withMainActivity } = require('@expo/config-plugins');

const MARKER = 'Osmani TV — app-wide FLAG_SECURE';
const SECURE_FLAG_SNIPPET = `
    // ${MARKER}
    window.setFlags(
      android.view.WindowManager.LayoutParams.FLAG_SECURE,
      android.view.WindowManager.LayoutParams.FLAG_SECURE,
    )`;

function injectSecureFlag(mainActivity) {
  let contents = mainActivity.contents;
  if (contents.includes(MARKER)) {
    return mainActivity;
  }

  if (/super\.onCreate\([^)]*\)/.test(contents)) {
    contents = contents.replace(
      /super\.onCreate\([^)]*\)/,
      (match) => `${match}${SECURE_FLAG_SNIPPET}`,
    );
  }

  if (/super\.onResume\(\)/.test(contents)) {
    contents = contents.replace(
      /super\.onResume\(\)/,
      (match) => `${match}${SECURE_FLAG_SNIPPET}`,
    );
  } else {
    const classMatch = contents.match(/class MainActivity[^{]*\{/);
    if (classMatch) {
      const insertAt = classMatch.index + classMatch[0].length;
      const onResumeBlock = `

  override fun onResume() {
    super.onResume()${SECURE_FLAG_SNIPPET}
  }
`;
      contents = `${contents.slice(0, insertAt)}${onResumeBlock}${contents.slice(insertAt)}`;
    }
  }

  mainActivity.contents = contents;
  return mainActivity;
}

const withGlobalSecureScreen = (config) =>
  withMainActivity(config, (cfg) => {
    cfg.modResults = injectSecureFlag(cfg.modResults);
    return cfg;
  });

module.exports = withGlobalSecureScreen;
