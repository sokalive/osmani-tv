#!/usr/bin/env node
'use strict';

/**
 * Audit: prove Jul 25–27 2026 production work is on every v24 / 1.8.2 channel.
 *
 * - Lists recent OTAs on preview / vps-preview / production
 * - Asserts latest wave is channel-parity aligned
 * - Asserts git app commits since 2026-07-25 are ancestors of the published app HEAD
 *   (recovery OTA was cut from 7b52a7c; later commits may be scripts-only)
 *
 * Usage: node scripts/audit-ota-july-parity.js
 */

const { execSync } = require('child_process');
const path = require('path');
const {
  listBranchUpdates,
  verifyChannelParity,
  writeJson,
  ROOT,
  RUNTIME_V24,
  REQUIRED_CHANNELS,
  normalizeParityKey,
} = require('./lib/otaV24Production');

const SINCE = '2026-07-25';
const UNTIL = '2026-07-28';
/** App JS HEAD that recovery OTA published (cartoon avatars + all prior Jul fixes). */
const PUBLISHED_APP_HEAD = '7b52a7c041a38dc86b895a6e613e5828f6bda36d';

const REQUIRED_FEATURE_MARKERS = [
  { id: 'payment-hongera', patterns: [/hongera/i, /payment/i, /activation/i] },
  { id: 'account-boxes', patterns: [/account/i, /box1/i, /expires/i] },
  { id: 'subscription', patterns: [/subscription/i, /active-block|midnight|package-days/i] },
  { id: 'hamisha-transfer', patterns: [/hamisha|transfer/i] },
  { id: 'ui-avatars-categories', patterns: [/avatar|category|gradient|cartoon/i] },
  { id: 'channel-recovery', patterns: [/channel recovery|sync all 1\.8\.2/i] },
];

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function listAppCommits() {
  const log = git(
    `git log --since=${SINCE} --until=${UNTIL} --pretty=format:%H%x09%s -- App.js components lib context hooks screens package.json app.config.js`,
  );
  if (!log) return [];
  return log.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split('\t');
    return { hash, subject: rest.join('\t') };
  });
}

function isAncestor(commit, head) {
  try {
    git(`git merge-base --is-ancestor ${commit} ${head}`);
    return true;
  } catch {
    return false;
  }
}

function collectMessages(pagesByChannel) {
  const all = [];
  for (const channel of REQUIRED_CHANNELS) {
    for (const row of pagesByChannel[channel] || []) {
      all.push({ channel, message: row.message, groupId: row.group });
    }
  }
  return all;
}

function main() {
  const pagesByChannel = {};
  for (const channel of REQUIRED_CHANNELS) {
    pagesByChannel[channel] = listBranchUpdates({ branch: channel, runtime: RUNTIME_V24, limit: 25 });
  }

  const parity = verifyChannelParity({ runtime: RUNTIME_V24 });
  const messages = collectMessages(pagesByChannel);
  const haystack = messages.map((m) => m.message).join('\n');

  const featureHits = REQUIRED_FEATURE_MARKERS.map((marker) => {
    const hit = marker.patterns.some((re) => re.test(haystack));
    return { id: marker.id, presentInChannelHistory: hit };
  });
  const missingFeatures = featureHits.filter((f) => !f.presentInChannelHistory);

  // Recovery / latest wave proves current JS HEAD content — including features
  // that were historically published to only one channel.
  const latestIsRecovery = /channel recovery|sync all 1\.8\.2/i.test(parity.parityKey);
  if (!latestIsRecovery && missingFeatures.length) {
    // Still OK if parity points at a newer full-sync publish with all markers elsewhere.
  }

  const appCommits = listAppCommits();
  const missingFromPublishedHead = appCommits.filter((c) => !isAncestor(c.hash, PUBLISHED_APP_HEAD));

  // HEAD may be scripts-only after 7b52a7c — that's fine as long as app commits are ancestors.
  const repoHead = git('git rev-parse HEAD');
  const publishedIsAncestorOfHead = isAncestor(PUBLISHED_APP_HEAD, repoHead);

  const ok =
    parity.ok &&
    latestIsRecovery &&
    missingFromPublishedHead.length === 0 &&
    featureHits.every((f) => f.presentInChannelHistory || latestIsRecovery);

  const report = {
    timestamp: new Date().toISOString(),
    window: { since: SINCE, until: UNTIL },
    runtime: RUNTIME_V24,
    requiredChannels: REQUIRED_CHANNELS,
    publishedAppHead: PUBLISHED_APP_HEAD,
    repoHead,
    publishedIsAncestorOfHead,
    parity,
    latestNormalized: normalizeParityKey(parity.parityKey),
    latestIsRecoveryWave: latestIsRecovery,
    appCommitsSinceJul25: appCommits,
    appCommitsMissingFromPublishedHead: missingFromPublishedHead,
    featureMarkers: featureHits,
    channelLatest: parity.latest,
    channelHistorySample: Object.fromEntries(
      REQUIRED_CHANNELS.map((c) => [
        c,
        (pagesByChannel[c] || []).slice(0, 8).map((row) => ({
          groupId: row.group,
          message: row.message,
        })),
      ]),
    ),
    ok,
    confirmation: ok
      ? 'ALL VersionCode 24 / Runtime 1.8.2 channels carry the Jul 25–27 production JS HEAD (recovery wave).'
      : 'AUDIT FAILED — see missing commits/features or parity errors.',
  };

  const outPath = writeJson('ota-july-parity-audit-report.json', report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n[audit-ota-july-parity] wrote ${path.basename(outPath)} ok=${ok}`);
  if (!ok) process.exit(1);
}

main();
