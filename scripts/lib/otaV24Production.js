'use strict';

/**
 * Canonical OTA policy for VersionCode 24 / Runtime 1.8.2.
 *
 * Native APKs with the same versionCode + runtimeVersion may still listen on
 * DIFFERENT Expo channels (preview | vps-preview | production). Every future
 * production JS release for runtime 1.8.2 MUST publish to ALL required channels
 * in one workflow, then pass channel-parity verification.
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME_V24 = '1.8.2';
const VERSION_CODE_V24 = 24;
/** Every installed v24 / 1.8.2 APK listens to one of these. */
const REQUIRED_CHANNELS = Object.freeze(['preview', 'vps-preview', 'production']);
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const ROOT = path.join(__dirname, '..', '..');
const API_URL = 'https://api.osmanitv.com';

function sleepSec(sec) {
  try {
    if (process.platform === 'win32') {
      execSync(`timeout /t ${sec} /nobreak`, { stdio: 'ignore' });
    } else {
      execSync(`sleep ${sec}`, { stdio: 'ignore' });
    }
  } catch {
    /* ignore */
  }
}

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitShort(head) {
  try {
    return execSync(`git rev-parse --short ${head}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return String(head || '').slice(0, 7);
  }
}

function readAppVersion() {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const appConfig = require(path.join(ROOT, 'app.config.js'));
  return String(appConfig?.expo?.version || '');
}

function readEasChannels() {
  const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
  return {
    preview: eas.build?.preview?.channel,
    'vps-preview': eas.build?.['vps-preview']?.channel,
    production: eas.build?.production?.channel,
  };
}

function channelsForRuntime(runtime) {
  if (String(runtime) === RUNTIME_V24) return [...REQUIRED_CHANNELS];
  // Older Play runtimes historically only used the production channel.
  return ['production'];
}

function parseJsonFromEasOutput(raw) {
  const text = String(raw || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith('npm warn')) return false;
      if (t.startsWith('npm error')) return false;
      if (/eas-cli@\d/.test(t)) return false;
      if (t.startsWith('★')) return false;
      if (t.startsWith('To upgrade')) return false;
      if (t.startsWith('Proceeding with')) return false;
      return true;
    })
    .join('\n');

  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  let start = -1;
  if (obj >= 0 && (arr < 0 || obj < arr)) start = obj;
  else if (arr >= 0) start = arr;
  if (start < 0) {
    throw new Error('EAS output did not contain JSON');
  }

  const slice = text.slice(start);
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) {
        throw new Error('EAS output JSON braces mismatched');
      }
      if (stack.length === 0) {
        return JSON.parse(slice.slice(0, i + 1));
      }
    }
  }
  throw new Error('EAS output JSON could not be parsed');
}

function runEas(args, env = {}) {
  const result = spawnSync(NPX, ['eas-cli', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      CI: '1',
      EAS_SKIP_AUTO_FINGERPRINT: '1',
      EXPO_PUBLIC_API_URL: API_URL,
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/** Windows-safe shell command (keeps --message quoting intact). */
function runEasCommand(command, env = {}) {
  const result = spawnSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      CI: '1',
      EAS_SKIP_AUTO_FINGERPRINT: '1',
      EXPO_PUBLIC_API_URL: API_URL,
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function assertPreflight({ runtime = RUNTIME_V24, versionCode = VERSION_CODE_V24 } = {}) {
  const errors = [];
  const appVersion = readAppVersion();
  if (appVersion !== runtime) {
    errors.push(`app.config version "${appVersion}" != required runtime "${runtime}"`);
  }

  const easChannels = readEasChannels();
  for (const channel of REQUIRED_CHANNELS) {
    if (easChannels[channel] !== channel) {
      errors.push(`eas.json build.${channel}.channel must be "${channel}" (got ${easChannels[channel]})`);
    }
  }

  if (Number(versionCode) !== VERSION_CODE_V24) {
    errors.push(`versionCode target must remain ${VERSION_CODE_V24} (got ${versionCode})`);
  }

  if (String(runtime) !== RUNTIME_V24) {
    errors.push(`OTA hardening targets runtime ${RUNTIME_V24} only (got ${runtime})`);
  }

  // Refuse accidental single-channel npm leftovers if someone reintroduces them.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    const c = String(cmd);
    if (/eas\s+update\s+--channel\s+(preview|production|vps-preview)\b/.test(c) && !c.includes('publish-production-ota')) {
      errors.push(
        `package.json script "${name}" publishes a single channel directly — use npm run ota:production`,
      );
    }
  }

  if (errors.length) {
    const err = new Error(`OTA preflight FAILED:\n- ${errors.join('\n- ')}`);
    err.errors = errors;
    throw err;
  }

  return {
    ok: true,
    runtime,
    versionCode: VERSION_CODE_V24,
    channels: [...REQUIRED_CHANNELS],
    commit: gitHead(),
    appVersion,
  };
}

function publishChannel({ channel, runtime, message, maxAttempts = 4 }) {
  const quotedMsg = String(message).replace(/"/g, '');
  const envFlag = channel === 'production' ? '--environment production ' : '';
  const cmd =
    `${NPX} eas-cli update --channel ${channel} ${envFlag}` +
    `--message "${quotedMsg}" --non-interactive`;

  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n=== OTA channel=${channel} runtime=${runtime} attempt=${attempt}/${maxAttempts} ===`);
    last = runEasCommand(cmd, { OTA_RUNTIME_TARGET: runtime });
    process.stdout.write(last.out);
    if (last.status === 0) {
      const groupMatch =
        last.out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
        last.out.match(/group[=:\s]+([a-f0-9-]{36})/i);
      const androidMatch = last.out.match(/Android update ID\s+([a-f0-9-]{36})/i);
      return {
        channel,
        runtime,
        ok: true,
        groupId: groupMatch ? groupMatch[1] : null,
        androidUpdateId: androidMatch ? androidMatch[1] : null,
        out: last.out,
      };
    }
    if (attempt < maxAttempts) sleepSec(attempt * 15);
  }

  return {
    channel,
    runtime,
    ok: false,
    groupId: null,
    androidUpdateId: null,
    out: last ? last.out : '',
    status: last ? last.status : 1,
  };
}

/**
 * Publish one runtime to every channel required by policy.
 * For 1.8.2 this is ALWAYS preview + vps-preview + production.
 */
function publishRuntimeToRequiredChannels({
  runtime = RUNTIME_V24,
  message,
  maxAttempts = 4,
} = {}) {
  if (!message || !String(message).trim()) {
    throw new Error('publish message is required');
  }
  const channels = channelsForRuntime(runtime);
  const groups = [];
  for (const channel of channels) {
    const result = publishChannel({ channel, runtime, message, maxAttempts });
    if (!result.ok) {
      const err = new Error(`OTA publish FAILED for channel=${channel} runtime=${runtime}`);
      err.result = result;
      throw err;
    }
    groups.push(result);
  }
  return { runtime, channels, groups, commit: gitHead() };
}

function listBranchUpdates({ branch, runtime = RUNTIME_V24, limit = 10 }) {
  const result = runEas([
    'update:list',
    '--branch',
    branch,
    '--runtime-version',
    runtime,
    '--limit',
    String(limit),
    '--json',
    '--non-interactive',
  ]);
  if (result.status !== 0) {
    throw new Error(`eas update:list failed for branch=${branch}: ${result.out.slice(0, 500)}`);
  }
  const data = parseJsonFromEasOutput(result.out);
  return Array.isArray(data?.currentPage) ? data.currentPage : [];
}

function normalizeParityKey(message) {
  return String(message || '')
    .replace(/^"+|"+$/g, '')
    .replace(/\s*\(\d+.*$/i, '')
    .replace(/\b(preview|vps-preview|production)\b/gi, '<channel>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Fail if the latest 1.8.2 update on each required channel is not the same release wave.
 * Compares normalized messages (channel name stripped) so recovery/publish waves match.
 */
function verifyChannelParity({ runtime = RUNTIME_V24, requireKeyword = null } = {}) {
  const latest = {};
  for (const channel of REQUIRED_CHANNELS) {
    const page = listBranchUpdates({ branch: channel, runtime, limit: 5 });
    if (!page.length) {
      throw new Error(`No updates found on channel/branch=${channel} runtime=${runtime}`);
    }
    latest[channel] = page[0];
  }

  const keys = REQUIRED_CHANNELS.map((c) => normalizeParityKey(latest[c].message));
  const unique = [...new Set(keys)];
  if (unique.length !== 1) {
    const detail = REQUIRED_CHANNELS.map((c) => `${c}: ${latest[c].message}`).join('\n');
    throw new Error(`OTA channel parity FAILED — latest messages diverge:\n${detail}`);
  }

  if (requireKeyword) {
    const hay = keys[0];
    if (!hay.includes(String(requireKeyword).toLowerCase())) {
      throw new Error(
        `OTA channel parity FAILED — expected keyword "${requireKeyword}" in latest message, got: ${keys[0]}`,
      );
    }
  }

  return {
    ok: true,
    runtime,
    parityKey: unique[0],
    latest: Object.fromEntries(
      REQUIRED_CHANNELS.map((c) => [
        c,
        {
          groupId: latest[c].group,
          message: latest[c].message,
          runtimeVersion: latest[c].runtimeVersion,
          platforms: latest[c].platforms,
        },
      ]),
    ),
  };
}

function writeJson(relPath, data) {
  const abs = path.join(ROOT, relPath);
  fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  return abs;
}

module.exports = {
  RUNTIME_V24,
  VERSION_CODE_V24,
  REQUIRED_CHANNELS,
  ROOT,
  NPX,
  API_URL,
  gitHead,
  gitShort,
  readAppVersion,
  readEasChannels,
  channelsForRuntime,
  assertPreflight,
  publishChannel,
  publishRuntimeToRequiredChannels,
  listBranchUpdates,
  normalizeParityKey,
  verifyChannelParity,
  writeJson,
  runEas,
  parseJsonFromEasOutput,
};
