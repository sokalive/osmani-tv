/**
 * Allow cleartext HTTP to the Contabo Admin API (IP:port) on Android.
 * Required for React Native fetch() — phone browsers are not subject to the same policy.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CONTABO_HOST = '144.91.117.90';

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${CONTABO_HOST}</domain>
  </domain-config>
</network-security-config>
`;

const withAndroidCleartextContabo = (config) => {
  let next = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:usesCleartextTraffic'] = 'true';
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

  next = withDangerousMod(next, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG_XML, 'utf8');
      return cfg;
    },
  ]);

  return next;
};

module.exports = withAndroidCleartextContabo;
