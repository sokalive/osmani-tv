#!/usr/bin/env node
/**
 * Build + rsync/scp deploy of web/dist to Contabo for https://osmanitv.com
 *
 * Env:
 *   OSMANI_VPS_HOST (default 144.91.117.90 / api.osmanitv.com)
 *   OSMANI_VPS_USER (default root)
 *   OSMANI_VPS_KEY  (default ~/.ssh/nassani_contabo_ed25519)
 *   OSMANI_VPS_WEB_ROOT (default /var/www/osmanitv.com)
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..');
const dist = path.join(webRoot, 'dist');

const host = process.env.OSMANI_VPS_HOST || '144.91.117.90';
const user = process.env.OSMANI_VPS_USER || 'root';
const key =
  process.env.OSMANI_VPS_KEY ||
  path.join(os.homedir(), '.ssh', 'nassani_contabo_ed25519');
const remoteRoot = process.env.OSMANI_VPS_WEB_ROOT || '/var/www/osmanitv.com';

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) process.exit(r.status || 1);
}

run('npm', ['run', 'build'], { cwd: webRoot });
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html missing');
  process.exit(1);
}

const sshBase = [
  '-i',
  key,
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'ConnectTimeout=20',
];

run('ssh', [...sshBase, `${user}@${host}`, `mkdir -p ${remoteRoot} && mkdir -p ${remoteRoot}-prev`]);
run('ssh', [
  ...sshBase,
  `${user}@${host}`,
  `if [ -f ${remoteRoot}/index.html ]; then rm -rf ${remoteRoot}-prev && cp -a ${remoteRoot} ${remoteRoot}-prev; fi`,
]);

const scpArgs = [...sshBase, '-r', `${dist}/.`, `${user}@${host}:${remoteRoot}/`];
run('scp', scpArgs);

run('ssh', [
  ...sshBase,
  `${user}@${host}`,
  `nginx -t && (systemctl reload nginx || service nginx reload || true) && ls -la ${remoteRoot} | head`,
]);

console.log('\n[deploy-web] published to https://osmanitv.com');
