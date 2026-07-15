#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function listJsFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listJsFiles(p, out);
    else if (/\.(js|jsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.js', '.jsx', '/index.js']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const files = listJsFiles(root);
const graph = new Map();
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const txt = fs.readFileSync(f, 'utf8');
  const specs = [...txt.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  graph.set(
    rel,
    specs.map((s) => resolve(f, s)).filter(Boolean).map((p) => path.relative(root, p).replace(/\\/g, '/')),
  );
}

function findCycle(start) {
  const stack = [start];
  const visiting = new Set([start]);
  const visited = new Set();
  function dfs(node) {
    if (visited.has(node)) return null;
    if (visiting.has(node)) return [...stack, node];
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const rel = next.replace(/\\/g, '/');
      if (!graph.has(rel)) continue;
      const c = dfs(rel);
      if (c) return c;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }
  return dfs(start);
}

const start = 'context/OsmaniAppContext.jsx';
const cycle = findCycle(start);
if (cycle) {
  console.error('CYCLE:', cycle.join(' -> '));
  process.exit(1);
}
console.log('No import cycle from', start);
