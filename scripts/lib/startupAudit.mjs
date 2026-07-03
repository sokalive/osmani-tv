/**
 * Shared startup audit utilities — import/JSX/export resolution for production guards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..', '..');

/** Intrinsic / platform JSX tags — never require a local import. */
export const JSX_INTRINSIC_ALLOWLIST = new Set([
  'ActivityIndicator',
  'Alert',
  'AppState',
  'BlurView',
  'BottomTabBar',
  'DarkTheme',
  'Dimensions',
  'ExpoImage',
  'FlatList',
  'Fragment',
  'Ionicons',
  'LinearGradient',
  'NavigationContainer',
  'Platform',
  'Pressable',
  'RefreshControl',
  'SafeAreaProvider',
  'SafeAreaView',
  'ScrollView',
  'StatusBar',
  'StyleSheet',
  'Text',
  'View',
]);

/**
 * Documented startup render tree (boot → first interactive Home).
 * Printed by verify-startup-imports for operators; not executed at runtime.
 */
export const STARTUP_DEPENDENCY_GRAPH = `
App (export default)
└── SafeAreaProvider
    └── EmbeddedOtaBootGate
        └── AppShell [useStartupSplash, useGlobalSecureScreen, boot hooks]
            └── StartupErrorBoundary
                └── OsmaniAppProvider [subscription recover, SSE, cache hydrate]
                    └── DeviceIntelligenceProvider
                        └── SecurityProvider
                            └── ModalSheetCoordinatorProvider
                                ├── NavigationContainer
                                │   └── PhoneNumberGate
                                │       ├── RootNavigator → AppTabs
                                │       │   ├── ChannelCatalogScreen (Home/Sports/Tamthilia)
                                │       │   └── AkauntiYanguScreen
                                │       └── OsmaniDeepLinkGate
                                ├── GlobalEmergencyGate → EmergencyModal
                                ├── DeviceIntelligenceGate
                                ├── NotificationPermissionReminderGate
                                ├── WhatsAppFloatingButtonGate
                                ├── PopupSettingsModal
                                ├── UpdateOverlay
                                ├── ChannelUpdateGateHost
                                ├── OtaDebugOverlay
                                ├── SubscriptionLifecycleGates
                                │   ├── TransferConfirmModal
                                │   ├── TransferSuccessModal
                                │   ├── TransferredAwayModal
                                │   ├── PremiumModal
                                │   └── SubscriptionActivationSuccessModal
                                └── GlobalPaymentModalGate → PremiumModal
`.trim();

/** Files whose JSX + imports are verified on every CI run. */
export const STARTUP_AUDIT_FILES = [
  'App.js',
  'context/OsmaniAppContext.jsx',
  'components/StartupErrorBoundary.js',
  'components/EmbeddedOtaBootGate.js',
  'components/PhoneNumberGate.jsx',
  'components/GlobalPaymentModalGate.js',
  'components/OsmaniDeepLinkGate.jsx',
  'components/DeviceIntelligenceGate.jsx',
  'components/ChannelUpdateGateHost.jsx',
  'components/SubscriptionActivationSuccessModal.js',
  'components/TransferSuccessModal.js',
  'components/TransferConfirmModal.js',
  'components/TransferredAwayModal.js',
  'components/PremiumModal.js',
];

/** Transitive import roots for circular-dependency checks. */
export const STARTUP_CYCLE_ROOTS = [
  'App.js',
  'context/OsmaniAppContext.jsx',
  'components/PhoneNumberGate.jsx',
  'components/PremiumModal.js',
];

export function readRepoFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`missing file: ${relPath}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

export function resolveRelativeImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const fromAbs = path.join(REPO_ROOT, fromRel);
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const ext of ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(REPO_ROOT, candidate).replace(/\\/g, '/');
    }
  }
  return null;
}

export function parseImports(source) {
  const imports = new Map();
  const importRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRegex.exec(source)) !== null) {
    const clause = m[1].trim();
    const spec = m[2];

    const addNamed = (block) => {
      const names = block
        .replace(/^{|}$/g, '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      for (const entry of names) {
        const asMatch = entry.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
        if (!asMatch) continue;
        const local = asMatch[2] || asMatch[1];
        imports.set(local, { spec, kind: 'named', exported: asMatch[1] });
      }
    };

    if (clause.startsWith('{')) {
      addNamed(clause);
    } else if (clause.startsWith('* as ')) {
      const local = clause.replace('* as ', '').trim();
      imports.set(local, { spec, kind: 'namespace' });
    } else if (clause.includes('{')) {
      const braceIdx = clause.indexOf('{');
      const defaultPart = clause
        .slice(0, braceIdx)
        .trim()
        .replace(/,\s*$/, '');
      if (defaultPart) {
        imports.set(defaultPart, { spec, kind: 'default' });
      }
      addNamed(clause.slice(braceIdx));
    } else {
      const local = clause.split(',')[0].trim();
      if (local) imports.set(local, { spec, kind: 'default' });
    }
  }
  return imports;
}

export function parseLocalBindings(source) {
  const locals = new Set();
  const patterns = [
    /function\s+([A-Z][\w$]*)\s*\(/g,
    /const\s+([A-Z][\w$]*)\s*=\s*(?:function|\(|React\.memo|createContext)/g,
    /class\s+([A-Z][\w$]*)\s+extends/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) {
      locals.add(m[1]);
    }
  }
  const stack = source.match(/const\s+Stack\s*=\s*createNativeStackNavigator\s*\(/);
  const tab = source.match(/const\s+Tab\s*=\s*createBottomTabNavigator\s*\(/);
  if (stack) {
    locals.add('Stack');
  }
  if (tab) {
    locals.add('Tab');
  }
  return locals;
}

export function extractJsxComponentNames(source) {
  const names = new Set();
  const tagRe = /<([A-Z][\w$]*)\b/g;
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    names.add(m[1]);
  }
  return names;
}

export function fileHasExport(relPath, { kind, exported }) {
  const source = readRepoFile(relPath);
  if (kind === 'default') {
    return /export\s+default\b/.test(source) || /module\.exports\s*=/.test(source);
  }
  if (kind === 'named' && exported) {
    const re = new RegExp(
      [
        `export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${exported}\\b`,
        `export\\s*\\{[^}]*\\b${exported}\\b`,
        `exports\\.${exported}\\s*=`,
        `module\\.exports\\.${exported}\\s*=`,
      ].join('|'),
    );
    return re.test(source);
  }
  return true;
}

export function buildImportGraph(relPaths) {
  const graph = new Map();
  for (const rel of relPaths) {
    const source = readRepoFile(rel);
    const specs = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
    const edges = [];
    for (const spec of specs) {
      const resolved = resolveRelativeImport(rel, spec);
      if (resolved) edges.push(resolved);
    }
    graph.set(rel, edges);
  }
  return graph;
}

export function findImportCycle(graph, start) {
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function dfs(node) {
    if (visiting.has(node)) return [...path, node];
    if (visited.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const next of graph.get(node) || []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  return dfs(start);
}

export function listTrackedJsFiles() {
  const out = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(js|jsx|mjs)$/.test(ent.name)) {
        out.push(path.relative(REPO_ROOT, p).replace(/\\/g, '/'));
      }
    }
  }
  walk(REPO_ROOT);
  return out;
}
