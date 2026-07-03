#!/usr/bin/env node
/**
 * Static startup import + JSX binding audit.
 * Run: node scripts/verify-startup-imports.mjs
 *
 * Fails CI if any startup-rendered component is used without import,
 * if the import target is missing, or if export shape mismatches usage.
 */

import {
  JSX_INTRINSIC_ALLOWLIST,
  REPO_ROOT,
  STARTUP_AUDIT_FILES,
  STARTUP_CYCLE_ROOTS,
  STARTUP_DEPENDENCY_GRAPH,
  buildImportGraph,
  extractJsxComponentNames,
  fileHasExport,
  findImportCycle,
  listTrackedJsFiles,
  parseImports,
  parseLocalBindings,
  readRepoFile,
  resolveRelativeImport,
} from './lib/startupAudit.mjs';

let exitCode = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

console.log('[verify-startup-imports] startup dependency graph:\n');
console.log(STARTUP_DEPENDENCY_GRAPH);
console.log('');

for (const rel of STARTUP_AUDIT_FILES) {
  const abs = `${REPO_ROOT}/${rel}`.replace(/\//g, '\\');
  try {
    readRepoFile(rel);
  } catch {
    fail(`startup audit file missing: ${rel}`);
    continue;
  }

  const source = readRepoFile(rel);
  const imports = parseImports(source);
  const locals = parseLocalBindings(source);
  const jsxNames = extractJsxComponentNames(source);

  for (const [local, meta] of imports.entries()) {
    if (!meta.spec.startsWith('.')) continue;
    const resolved = resolveRelativeImport(rel, meta.spec);
    if (!resolved) {
      fail(`${rel}: import "${local}" from "${meta.spec}" does not resolve`);
      continue;
    }
    if (!fileHasExport(resolved, meta)) {
      fail(
        `${rel}: import "${local}" from "${resolved}" — expected ${meta.kind} export` +
          (meta.exported ? ` "${meta.exported}"` : ''),
      );
    }
  }

  for (const name of jsxNames) {
    if (JSX_INTRINSIC_ALLOWLIST.has(name)) continue;
    if (locals.has(name)) continue;
    if (imports.has(name)) continue;
    fail(`${rel}: JSX <${name}> has no import, local definition, or allowlist entry`);
  }

  if (exitCode === 0) {
    pass(`${rel}: ${jsxNames.size} JSX tags, ${imports.size} imports verified`);
  }
}

const tracked = new Set(listTrackedJsFiles());
const auditSet = new Set(STARTUP_AUDIT_FILES);

for (const root of STARTUP_CYCLE_ROOTS) {
  if (!auditSet.has(root)) continue;
  const subgraph = new Map();
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    const edges = (buildImportGraph([node]).get(node) || []).filter((e) => auditSet.has(e));
    subgraph.set(node, edges);
    for (const e of edges) {
      if (!seen.has(e)) queue.push(e);
    }
  }
  const cycle = findImportCycle(subgraph, root);
  if (cycle) {
    fail(`import cycle from ${root}: ${cycle.join(' -> ')}`);
  } else {
    pass(`no import cycle from ${root}`);
  }
}

if (exitCode) {
  console.error('\n[verify-startup-imports] FAILED');
  process.exit(exitCode);
}

console.log('\n[verify-startup-imports] ok');
