/**
 * OC-INBOX-05 mounted-fixture server (tests-only; not a production route).
 *
 * Serves the REAL production client components compiled to browser ESM on the fly
 * with the repository's own installed TypeScript, plus synthetic same-contract
 * adapters for next/navigation, next/link, the Supabase browser client and
 * window.fetch (scripted, deferrable responses). Everything here lives under
 * tests/browser/oc-inbox/** (allowlisted) and is labelled FIXTURE.
 *
 * No production file, route, gate, next.config or package is modified. No .env
 * or credential is read; the server binds only to 127.0.0.1 on a port the
 * runner chose (free port at runtime, only its own process is closed).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url)); // tests/browser/oc-inbox/harness
const FIXTURES_DIR = path.resolve(HARNESS_DIR, '..', 'fixtures');
const WORKTREE_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..', '..'); // repo root of the worktree

const requireTs = createRequire(path.join(WORKTREE_ROOT, 'package.json'));
let ts;
try {
  ts = requireTs('typescript');
} catch (error) {
  throw new Error('FIXTURE_SERVER_DEPENDENCY: typescript unreadable via worktree node_modules junction — ' + error.message);
}
const ReactExports = Object.keys(requireTs('react')).filter(isExportable);
const JsxExports = Object.keys(requireTs('react/jsx-runtime')).filter(isExportable);
const DomClientExports = Object.keys(requireTs('react-dom/client')).filter(isExportable);
const ZodExports = Object.keys(requireTs('zod')).filter(isExportable);

function isExportable(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

const bareMap = new Map([
  ['react', '/shim/react.js'],
  ['react/jsx-runtime', '/shim/react-jsx-runtime.js'],
  ['react-dom', '/shim/react.js'],
  ['react-dom/client', '/shim/react-dom-client.js'],
  ['next/navigation', '/fix/next-navigation.js'],
  ['next/link', '/fix/next-link.js'],
  ['@/lib/supabase/browser', '/fix/supabase-browser.js'],
  ['zod', '/shim/zod.js'],
]);

const compileCache = new Map();

function resolveRepoFile(specifierPath) {
  const candidates = ['.tsx', '.ts', '.jsx', '.js'];
  for (const extension of candidates) {
    const candidate = path.join(WORKTREE_ROOT, specifierPath) + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Remaps module specifiers through the AST (regex on raw output text cannot
// distinguish the word `from` inside string literals such as ['from', 'to']).
// Inline `type` specifiers must be dropped manually: a synthesized import
// declaration bypasses the type-elision pass and the browser rejects the
// non-JS `type X` member syntax.
function remapImports(directory) {
  return context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (node.importClause && node.importClause.isTypeOnly) return ts.factory.createNotEmittedStatement(node);
        let clause = node.importClause;
        if (clause && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const kept = clause.namedBindings.elements.filter(element => !element.isTypeOnly);
          if (kept.length === 0) return ts.factory.createNotEmittedStatement(node);
          clause = ts.factory.createImportClause(false, clause.name, ts.factory.createNamedImports(kept));
        }
        return ts.factory.createImportDeclaration(
          node.modifiers, clause,
          ts.factory.createStringLiteral(rewriteSpecifier(node.moduleSpecifier.text, directory)),
        );
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (node.isTypeOnly) return ts.factory.createNotEmittedStatement(node);
        let exports = node.exportClause;
        if (exports && ts.isNamedExports(exports)) {
          const kept = exports.elements.filter(element => !element.isTypeOnly);
          if (kept.length === 0) return ts.factory.createNotEmittedStatement(node);
          exports = ts.factory.createNamedExports(kept);
        }
        return ts.factory.createExportDeclaration(
          node.modifiers, false, exports,
          ts.factory.createStringLiteral(rewriteSpecifier(node.moduleSpecifier.text, directory)),
        );
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
        return ts.factory.updateCallExpression(
          node, node.expression, node.typeArguments,
          [ts.factory.createStringLiteral(rewriteSpecifier(node.arguments[0].text, directory))],
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return sourceFile => ts.visitEachChild(sourceFile, visit, context);
  };
}

// Bare specifiers synthetized at emit time (jsx runtime) plus identical ones in
// parsed statements; the bounded alternation cannot match unrelated code text.
const BARE_SPECIFIER_PATTERN = '(react|react\\/jsx-runtime|react-dom\\/client|react-dom|react|next\\/[\\w-]+|zod)';

function compileModule(absolutePath) {
  const relative = path.relative(WORKTREE_ROOT, absolutePath).split(path.sep).join('/').replace(/\.(ts|tsx|jsx)$/u, '');
  const cacheKey = relative;
  if (compileCache.has(cacheKey)) return compileCache.get(cacheKey);
  let source = fs.readFileSync(absolutePath, 'utf8');
  source = source.replace(/^\s*["']use client["'];\s*$/m, '');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      removeComments: true,
    },
    fileName: absolutePath,
    transformers: {before: [remapImports(path.dirname(absolutePath))]},
  }).outputText;
  const rewritten = output.replace(new RegExp(`(import\\s*\\(\\s*|from)\\s*["']${BARE_SPECIFIER_PATTERN}["']`, 'g'),
    (match, clause, specifier) => `${clause} "${bareMap.get(specifier)}"`);
  const moduleText = `${rewritten}\n`;
  compileCache.set(cacheKey, moduleText);
  return moduleText;
}

function rewriteSpecifier(specifier, importingDir) {
  if (bareMap.has(specifier)) return bareMap.get(specifier);
  if (specifier.startsWith('@/types/')) return '/fix/types-runtime-guard.js';
  if (specifier.startsWith('@/lib/')) return `/src/${specifier.slice(2)}.js`;
  if (specifier.startsWith('@/app/')) return `/src/${specifier.slice(2)}.js`;
  if (specifier.startsWith('.')) {
    const target = path.resolve(importingDir, specifier);
    if (!path.relative(WORKTREE_ROOT, target).includes('..')) {
      const resolved = resolveRepoFile(path.relative(WORKTREE_ROOT, target).split(path.sep).join('/'));
      if (resolved) {
        const relative = path.relative(WORKTREE_ROOT, resolved).split(path.sep).join('/').replace(/\.(ts|tsx|jsx)$/u, '');
        return `/src/${relative}.js`;
      }
    }
    // Fixture-entry relative imports (outside the worktree root routing) fall back
    // to harness-local modules such as the boot reader.
    const harnessResolved = path.resolve(importingDir, specifier);
    const harnessRelative = literalPath(harnessResolved);
    if (harnessRelative) return harnessRelative;
  }
  throw new Error(`FIXTURE_MODULE_MAP_FALLBACK: unhandled import specifier "${specifier}" in ${importingDir}`);
}

function literalPath(file) {
  if (!fs.existsSync(file)) {
    for (const extension of ['.tsx', '.ts', '.js', '.mjs']) {
      if (fs.existsSync(file + extension)) return `/harness-src/${file.slice(FIXTURES_DIR.length + 1)}${extension}`;
    }
    return null;
  }
  return `/harness-src/${file.slice(FIXTURES_DIR.length + 1)}`;
}

const RESERVED_EXPORT_NAMES = new Set([
  'default', 'null', 'undefined', 'void', 'true', 'false', 'new', 'delete', 'typeof', 'instanceof', 'in',
  'this', 'super', 'extends', 'class', 'function', 'var', 'let', 'const', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally', 'import',
  'export', 'yield', 'await', 'enum', 'with', 'debugger',
]);

function shimExports(globalName, exports, extra = '') {
  const lines = [`const value=window.${globalName};`];
  const aliases = [];
  let reservedIndex = 0;
  for (const name of exports) {
    if (RESERVED_EXPORT_NAMES.has(name)) {
      if (name === 'default') continue; /* the final `export default value;` already covers it */
      const alias = `__yruReserved${reservedIndex++}`;
      lines.push(`const ${alias}=value[${JSON.stringify(name)}];`);
      aliases.push(`export { ${alias} as ${name} };`);
      continue;
    }
    lines.push(`export const ${name}=value[${JSON.stringify(name)}];`);
  }
  lines.push('export default value;');
  lines.push(...aliases);
  return extra + lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Vendor runtime bundle. The installed React/zod packages are CJS      */
/* only; the classic bundle embeds them behind a tiny require()         */
/* registry evaluated before any fixture module (window globals).      */
/* ------------------------------------------------------------------ */

const REACT_ROOT = fs.realpathSync(path.dirname(requireTs.resolve('react/package.json')));
const REACT_DOM_ROOT = fs.realpathSync(path.dirname(requireTs.resolve('react-dom/package.json')));
const ZOD_ROOT = fs.realpathSync(path.dirname(requireTs.resolve('zod/package.json')));
const SCHEDULER_ROOT = path.join(path.dirname(REACT_DOM_ROOT), 'scheduler', 'cjs', 'scheduler.production.js');
const REACT_PROD = path.join(REACT_ROOT, 'cjs/react.production.js');
const REACT_JSX_RUNTIME_PROD = path.join(REACT_ROOT, 'cjs/react-jsx-runtime.production.js');
const REACT_DOM_PROD = path.join(REACT_DOM_ROOT, 'cjs/react-dom.production.js');
const REACT_DOM_CLIENT_PROD = path.join(REACT_DOM_ROOT, 'cjs/react-dom-client.production.js');
const ZOD_INDEX_CJS = path.join(ZOD_ROOT, 'index.cjs');

let runtimeBundleCache = null;

function cjsModuleReach(targetAbsolute) {
  return fs.existsSync(targetAbsolute) && fs.statSync(targetAbsolute).isFile();
}

/** Visitor that enumerates the whole zod CommonJS graph (relative requires only). */
function walkZodCjs(fileAbsolute, registry) {
  if (registry.has(fileAbsolute) || !cjsModuleReach(fileAbsolute)) return;
  const source = fs.readFileSync(fileAbsolute, 'utf8');
  registry.set(fileAbsolute, {fileAbsolute, source});
  for (const match of source.matchAll(/require\(\s*(["'])([^"']+)\1\s*\)/g)) {
    const specifier = match[2];
    if (!specifier.startsWith('.')) {
      if (specifier === 'zod' || specifier.startsWith('zod/')) continue; /* maps to the root module */
      throw new Error(`FIXTURE_RUNTIME_BUNDLE: bare require "${specifier}" inside ${fileAbsolute}`);
    }
    const bases = specifier.endsWith('.cjs')
      ? [path.resolve(path.dirname(fileAbsolute), specifier)]
      : [path.resolve(path.dirname(fileAbsolute), specifier + '.cjs'), path.resolve(path.dirname(fileAbsolute), specifier, 'index.cjs')];
    const hit = bases.find(cjsModuleReach);
    if (!hit) throw new Error(`FIXTURE_RUNTIME_BUNDLE: zod file ${fileAbsolute} requires unresolved "${specifier}"`);
    walkZodCjs(fs.realpathSync(hit), registry);
  }
}

function cjsRequireRewrite(source, mapSpecifier) {
  // CJS production bundles call require with string literals only.
  return source.replace(/require\(\s*(["'])([^"']+)\1\s*\)/g, (match, _quote, specifier) => mapSpecifier(specifier));
}

function buildRuntimeBundle() {
  if (runtimeBundleCache) return runtimeBundleCache;
  if (!cjsModuleReach(REACT_PROD) || !cjsModuleReach(REACT_JSX_RUNTIME_PROD)
    || !cjsModuleReach(REACT_DOM_PROD) || !cjsModuleReach(REACT_DOM_CLIENT_PROD)
    || !cjsModuleReach(SCHEDULER_ROOT) || !cjsModuleReach(ZOD_INDEX_CJS)) {
    throw new Error(`FIXTURE_RUNTIME_BUNDLE: vendor cjs sources unreadable (${REACT_PROD}…${ZOD_INDEX_CJS})`);
  }
  // Enumerate the whole zod CommonJS graph (relative requires only).
  const zodRegistry = new Map(); // absolute-file -> {fileAbsolute, source}
  walkZodCjs(ZOD_INDEX_CJS, zodRegistry);
  // Root module keyed 'zod'; the internal files keyed "@zod/<relative>.cjs".
  const zodNameForFile = file => file === ZOD_INDEX_CJS ? 'zod' : '@zod/' + path.relative(ZOD_ROOT, file).split(path.sep).join('/');

  const zodSources = [...zodRegistry.values()];
  const parts = [
    '/* Fixture vendor bundle (tests-only): embedded CJS runtime for React 19 / zod 4.',
    '   Evaluated as a classic script BEFORE fixture modules; exposes window.__YRU_REACT__ etc. */',
    '(function() {',
    '  "use strict";',
    '  var registered = new Map();',
    '  function __yruDefine(name, body) {',
    '    registered.set(name, {module: {exports: {}}, body: body, executed: false});',
    '  }',
    '  function __yruRequire(name) {',
    '    var entry = registered.get(name);',
    '    if (!entry) throw new Error("YRU_SHIM_MISSING_MODULE " + name);',
    '    if (entry.executed) return entry.module.exports; /* in-progress cycle => current exports identity */',
    '    entry.executed = true;',
    '    entry.body(entry.module);',
    '    return entry.module.exports;',
    '  }',
    '  window.__yruRequire = __yruRequire;',
  ];
  const defineFor = (name, sourcePath, source, mapSpecifier) => {
    parts.push(`__yruDefine(${JSON.stringify(name)}, function (module) {`);
    parts.push('  "use strict";');
    parts.push('  var exports = module.exports;');
    parts.push(cjsRequireRewrite(source, mapSpecifier));
    parts.push('  return module.exports;');
    parts.push('});');
    void sourcePath;
  };
  const bareMapForVendor = specifier => {
    if (specifier === 'scheduler') return '__yruRequire("scheduler")';
    if (specifier === 'react') return '__yruRequire("react")';
    if (specifier === 'react-dom') return '__yruRequire("react-dom")';
    if (specifier === 'react/jsx-runtime') return '__yruRequire("react/jsx-runtime")';
    if (specifier === 'zod') return '__yruRequire("zod")';
    return null;
  };
  defineFor('react', REACT_PROD, fs.readFileSync(REACT_PROD, 'utf8'), specifier => bareMapForVendor(specifier)
    || (() => { throw new Error(`FIXTURE_RUNTIME_BUNDLE: react requires "${specifier}"`); })());
  defineFor('react/jsx-runtime', REACT_JSX_RUNTIME_PROD, fs.readFileSync(REACT_JSX_RUNTIME_PROD, 'utf8'), specifier => bareMapForVendor(specifier)
    || (() => { throw new Error(`FIXTURE_RUNTIME_BUNDLE: jsx-runtime requires "${specifier}"`); })());
  defineFor('scheduler', SCHEDULER_ROOT, fs.readFileSync(SCHEDULER_ROOT, 'utf8'), specifier => bareMapForVendor(specifier)
    || (() => { throw new Error(`FIXTURE_RUNTIME_BUNDLE: scheduler requires "${specifier}"`); })());
  defineFor('react-dom', REACT_DOM_PROD, fs.readFileSync(REACT_DOM_PROD, 'utf8'), specifier => bareMapForVendor(specifier)
    || (() => { throw new Error(`FIXTURE_RUNTIME_BUNDLE: react-dom requires "${specifier}"`); })());
  defineFor('react-dom/client', REACT_DOM_CLIENT_PROD, fs.readFileSync(REACT_DOM_CLIENT_PROD, 'utf8'), specifier => bareMapForVendor(specifier)
    || (() => { throw new Error(`FIXTURE_RUNTIME_BUNDLE: react-dom/client requires "${specifier}"`); })());
  for (const item of zodSources) {
    const name = zodNameForFile(item.fileAbsolute);
    defineFor(name, item.fileAbsolute, item.source, specifier => {
      if (!specifier.startsWith('.')) {
        const vendor = bareMapForVendor(specifier);
        if (vendor) return vendor;
        throw new Error(`FIXTURE_RUNTIME_BUNDLE: bare require "${specifier}" inside zod module ${name}`);
      }
      const bases = specifier.endsWith('.cjs')
        ? [path.resolve(path.dirname(item.fileAbsolute), specifier)]
        : [path.resolve(path.dirname(item.fileAbsolute), specifier + '.cjs'), path.resolve(path.dirname(item.fileAbsolute), specifier, 'index.cjs')];
      const hit = bases.find(cjsModuleReach);
      if (!hit) throw new Error(`FIXTURE_RUNTIME_BUNDLE: unresolved zod require "${specifier}" in ${name}`);
      return `__yruRequire(${JSON.stringify(zodNameForFile(fs.realpathSync(hit)))})`;
    });
  }
  parts.push('  window.__YRU_REACT__ = __yruRequire("react");');
  parts.push('  window.__YRU_REACT_JSXRUNTIME__ = __yruRequire("react/jsx-runtime");');
  parts.push('  window.__YRU_REACT_DOM_CLIENT__ = __yruRequire("react-dom/client");');
  parts.push('  window.__YRU_ZOD__ = __yruRequire("zod");');
  parts.push('})();');
  runtimeBundleCache = parts.join('\n');
  return runtimeBundleCache;
}

const synthetic = {
  ticketSeed(params, url) {
    const revision = intParam(params.get('rev'), 7);
    const status = params.get('status') ?? 'STAFF_HANDLING';
    const mode = params.get('mode') ?? 'HUMAN';
    const messageCount = intParam(params.get('messages'), 3);
    const seqFrom = intParam(params.get('seqFrom'), 1);
    const hasMore = params.get('hasMore') === '1';
    const deliveryParam = params.get('delivery');
    const permissionSeed = params.get('perms') ?? 'accept=1,reply=1,resolve=1,close=1,reassign=1,reopen=1';
    const permissions = Object.fromEntries(permissionSeed.split(',').map(piece => {
      const [key, value] = piece.split('=');
      return [key ?? '', value !== '0'];
    }));
    const ticketId = params.get('ticket') ?? '11111111-1111-4111-8111-111111111111';
    // Timestamps stay ordered for readability; sequence ids are unique per window.
    const minutes = 10 + (seqFrom % 50);
    const messages = Array.from({length: messageCount}, (_, index) => ({
      id: `m-${seqFrom + index}`,
      sequence: seqFrom + index,
      senderType: index % 2 === 0 ? 'USER' : 'STAFF',
      staffName: index % 2 === 0 ? null : 'เจ้าหน้าที่ Fixtures',
      content: `ข้อความสังเคราะห์ ${seqFrom + index}`,
      createdAt: `2026-10-28T01:${String(minutes + index).padStart(2, '0')}:00.000Z`,
      deliveryStatus: deliveryParam ? (index === 1 ? deliveryParam : (index === 3 ? 'UNKNOWN' : null)) : (index === 1 ? 'SENT' : null),
      attachments: [],
    }));
    return {
      detail: {
        ticket: {
          id: ticketId,
          ticket_no: 'T-2026-0009',
          department_id: '22222222-2222-4222-8222-222222222222',
          department_name: 'งานทะเบียน (fixture)',
          category: 'REG_ALL',
          problem_summary: 'คำร้อนสังเคราะห์เกี่ยวกับระบบ',
          priority: 'HIGH',
          status,
          mode,
          sensitive_level: 'GENERAL',
          assigned_staff_id: 'staff-fixture-a',
          assignee_name: 'เจ้าหน้าที่ Fixtures',
          revision,
          created_at: '2026-10-28T01:00:00.000Z',
          updated_at: '2026-10-28T02:00:00.000Z',
          anonymous_code: 'F1X2R3',
        },
        messages: [],
        history: [
          {id: 'h-1', action: 'CREATED', from_status: null, to_status: 'NEW', created_at: '2026-10-28T01:00:00.000Z', actor_name: null},
        ],
        assignees: [
          {id: '33333333-3333-4333-8333-333333333333', display_name: 'เจ้าหน้าที่อีกคน (fixture)'},
        ],
        deliveries: [],
        permissions: {
          accept: permissions.accept ?? true,
          reply: permissions.reply ?? true,
          resolve: permissions.resolve ?? true,
          close: permissions.close ?? true,
          reassign: permissions.reassign ?? true,
          reopen: permissions.reopen ?? true,
        },
      },
      messages,
      notes: [
        {id: 'n-1', text: 'บันทึกส่วนตัวสังเคราะห์', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:10:00.000Z'},
      ],
      latestSequence: seqFrom + messageCount - 1,
      readThroughSequence: intParam(params.get('readThrough'), Math.max(0, seqFrom + messageCount - 2)),
      hasMore,
      nextBefore: hasMore ? intParam(params.get('nextBefore'), seqFrom) : null,
    };
  },
  applyContext() {
    return {
      authenticated: true, lineLinked: true, staffActive: false, loginAvailable: true, canReview: false,
      application: null,
      departments: [
        {id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'},
        {id: '55555555-5555-4555-8555-555555555555', name: 'งานกิจการนักเรียน (fixture)'},
      ],
    };
  },
  approvalsList(params) {
    const items = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        applicantName: 'ผู้สมัครสังเคราะห์',
        staffCode: 'STFF-0001',
        requestedDepartmentId: '44444444-4444-4444-8444-444444444444',
        requestedDepartmentName: 'งานทะเบียนสถานศึกษา (fixture)',
        approvedDepartmentId: null, approvedDepartmentName: null,
        status: params.get('rowStatus') ?? 'PENDING',
        revision: intParam(params.get('rowRev'), 1),
        submittedAt: '2026-10-28T09:00:00.000Z',
        reviewedAt: null, reviewerName: null, decisionReason: null,
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        applicantName: 'ผู้สมัครเก่าอีกราย (fixture)',
        staffCode: 'STFF-0002',
        requestedDepartmentId: '55555555-5555-4555-8555-555555555555',
        requestedDepartmentName: 'งานกิจการนักเรียน (fixture)',
        approvedDepartmentId: '55555555-5555-4555-8555-555555555555',
        approvedDepartmentName: 'งานกิจการนักเรียน (fixture)',
        status: 'APPROVED',
        revision: 2,
        submittedAt: '2026-10-27T09:00:00.000Z',
        reviewedAt: '2026-10-27T10:00:00.000Z', reviewerName: 'ผู้ดูแล Fixtures', decisionReason: null,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        applicantName: 'ผู้สมัครจบราย (fixture)',
        staffCode: 'STFF-0003',
        requestedDepartmentId: '44444444-4444-4444-8444-444444444444',
        requestedDepartmentName: 'งานทะเบียนสถานศึกษา (fixture)',
        approvedDepartmentId: null, approvedDepartmentName: null,
        status: 'REJECTED',
        revision: 2,
        submittedAt: '2026-10-26T09:00:00.000Z',
        reviewedAt: '2026-10-26T10:00:00.000Z', reviewerName: 'ผู้ดูแล Fixtures', decisionReason: 'ข้อมูลไม่ครบ (fixture)',
      },
    ];
    const filter = params.get('status');
    const visible = filter ? items.filter(item => item.status === filter) : items;
    return {
      items: visible,
      departments: [{id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'},
        {id: '55555555-5555-4555-8555-555555555555', name: 'งานกิจการนักเรียน (fixture)'}],
      pagination: {page: 1, pageSize: 25, total: visible.length, totalPages: 1, hasNext: false, hasPrevious: false},
    };
  },
};

function intParam(raw, fallback) {
  const parse = Number(raw);
  return Number.isInteger(parse) && parse > 0 ? parse : fallback;
}

const FIXTURE_BANNER = 'FIXTURE OC-INBOX-05 — production components compiled for the fixture; synthetic adapters; no real backend, auth or data';

function fixturePage(entry, boot, title) {
  return `<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/static/inbox.css">
<link rel="stylesheet" href="/static/tickets.css">
<link rel="stylesheet" href="/static/staff-onboarding.css">
<link rel="stylesheet" href="/static/incidents.css">
<style>
  body{margin:0;font-family:sans-serif;background:#fff;}
  .fixture-banner{background:#7f1d1d;color:#fff;padding:6px 10px;font-size:12px;font-weight:700;letter-spacing:.04em;}
  #fixture-root{min-height:90vh;}
</style>
</head>
<body>
<div class="fixture-banner">${FIXTURE_BANNER}</div>
<div id="fixture-root"></div>
<script type="application/json" id="fixture-boot">${JSON.stringify(boot ?? null)}</script>
<script src="/shim/runtime-bundle.js"></script>
<script type="module" src="/fix/fetch-shim.js"></script>
<script type="module" src="/harness-origin/${entry}.js"></script>
</body></html>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  try { respond(request, response, url, pathname); }
  catch (error) {
    response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'});
    response.end('FIXTURE_SERVER_ERROR ' + (error && error.message));
  }
});

function respond(request, response, url, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405); response.end(); return;
  }
  // Compiled production sources.
  if (pathname.startsWith('/src/')) {
    const rel = pathname.slice('/src/'.length).replace(/\.js$/u, '');
    const file = resolveRepoFile(rel);
    if (!file) { response.writeHead(404); response.end('FIXTURE_SRC_404 ' + rel); return; }
    respondText(response, compileModule(file), 'text/javascript');
    return;
  }
  // Compiled entry modules (they live under tests/browser/oc-inbox/fixtures).
  if (pathname.startsWith('/harness-origin/')) {
    const name = pathname.slice('/harness-origin/'.length).replace(/\.js$/u, '');
    const file = path.join(FIXTURES_DIR, name + '.tsx');
    if (!fs.existsSync(file)) { response.writeHead(404); response.end('FIXTURE_ENTRY_404'); return; }
    respondText(response, compileModule(file), 'text/javascript');
    return;
  }
  if (pathname.startsWith('/harness-src/')) {
    const file = path.join(FIXTURES_DIR, pathname.slice('/harness-src/'.length));
    if (!fs.existsSync(file)) { response.writeHead(404); response.end('404'); return; }
    respondText(response, compileModule(file), 'text/javascript');
    return;
  }
  if (pathname === '/static/inbox.css') return respondStatic(response, 'app/(dashboard)/inbox/inbox.css');
  if (pathname === '/static/tickets.css') return respondStatic(response, 'app/tickets.css');
  if (pathname === '/static/staff-onboarding.css') return respondStatic(response, 'app/staff-onboarding.css');
  if (pathname === '/static/incidents.css') return respondStatic(response, 'app/incidents.css');

  if (pathname === '/shim/runtime-bundle.js') return respondText(response, buildRuntimeBundle(), 'text/javascript');
  if (pathname === '/shim/react.js') return respondText(response, shimExports('__YRU_REACT__', ReactExports), 'text/javascript');
  if (pathname === '/shim/react-jsx-runtime.js') return respondText(response, shimExports('__YRU_REACT_JSXRUNTIME__', JsxExports), 'text/javascript');
  if (pathname === '/shim/react-dom-client.js') return respondText(response, shimExports('__YRU_REACT_DOM_CLIENT__', DomClientExports), 'text/javascript');
  if (pathname === '/shim/zod.js') return respondText(response, shimExports('__YRU_ZOD__', ZodExports), 'text/javascript');

  if (pathname === '/fix/fetch-shim.js') return respondText(response, FETCH_SHIM, 'text/javascript');
  if (pathname === '/fix/next-navigation.js') return respondText(response, NEXT_NAVIGATION, 'text/javascript');
  if (pathname === '/fix/next-link.js') return respondText(response, NEXT_LINK, 'text/javascript');
  if (pathname === '/fix/supabase-browser.js') return respondText(response, SUPABASE_FIXTURE, 'text/javascript');
  if (pathname === '/fix/types-runtime-guard.js') return respondText(response, 'export function __TYPELESS_RUNTIME_IMPORT__(){throw new Error("FIXTURE: value import from @/types/* leaked into runtime");}', 'text/javascript');

  const params = url.searchParams;
  if (pathname === '/fixture/inbox' || pathname === '/inbox' || pathname === '/') {
    return respondHtml(response, fixturePage('inbox-entry', inboxBootParams(params), 'FIXTURE inbox'));
  }
  if (pathname.startsWith('/tickets/')) {
    return respondHtml(response, fixturePage('detail-entry', {
      initialThread: synthetic.ticketSeed(params),
    }, 'FIXTURE ticket detail'));
  }
  if (pathname === '/fixture/detail') {
    return respondHtml(response, fixturePage('detail-entry', {
      initialThread: synthetic.ticketSeed(params),
    }, 'FIXTURE detail'));
  }
  if (pathname === '/staff/apply' || pathname === '/fixture/apply') {
    return respondHtml(response, fixturePage('apply-entry', {context: synthetic.applyContext()}, 'FIXTURE apply'));
  }
  if (pathname === '/staff-applications' || pathname === '/fixture/approvals') {
    return respondHtml(response, fixturePage('approvals-entry', {list: synthetic.approvalsList(params)}, 'FIXTURE approvals'));
  }
  if (pathname === '/fixture/incident-batch') {
    return respondHtml(response, fixturePage('incident-batch-entry', {
      incidentId: params.get('incident') ?? '33333333-3333-4333-8333-333333333333',
      actorId: params.get('actor') ?? '66666666-6666-4666-8666-666666666666',
    }, 'FIXTURE incident batch'));
  }
  response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
  response.end(`FIXTURE 404 ${pathname} — the fixture only serves inbox/tickets/staff-apply/staff-applications stubs`);
}

function inboxBootRawParams(search) {
  // Mirror the Next.js raw searchParams contract: duplicate query keys arrive as arrays.
  const record = {};
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

function inboxBootParams(params) {
  return {
    actorId: params.get('actor') ?? 'staff-fixture-a',
    initialTicketId: params.get('ticket'),
    initialParams: inboxBootRawParams(params),
  };
}

function respondHtml(response, html) {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end(html);
}

function respondStatic(response, rel) {
  const file = path.join(WORKTREE_ROOT, rel);
  if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  respondText(response, fs.readFileSync(file, 'utf8'), 'text/css');
}

function respondText(response, text, type) {
  response.writeHead(200, {'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store'});
  response.end(text);
}

const FETCH_SHIM = `
// OC-OPERATOR-06 (OP06-10): per-scenario caps. Exceeding a cap stops the
// capture and marks the run CAPPED (the runner reports it as a failure with a
// compact summary instead of growing unbounded evidence files).
const CAPS = {requests: 250, bodyBytes: 16384, console: 120};
const shim = {routes: [], requests: [], pending: new Map(), seq: 0, buffer: [], configured: false, capped: {requests: null, bodyEntries: 0}};
function parseRequestId(raw) { try { const body = JSON.parse(raw); return typeof body?.requestId === 'string' ? body.requestId : null; } catch { return null; } }
function respondWith(status, body, contentType) {
  // OC-OPERATOR-06 (H1): object bodies must reach the app as REAL HTTP JSON.
  // String(body) produced '[object Object]' for scripted/deferred object bodies,
  // which made S11's deferred note 200 unparsable and its old PASS bogus.
  let text = '';
  if (body !== undefined && body !== null) text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {status, headers: {'content-type': contentType || 'application/json'}});
}
function record(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const method = (init && init.method || 'GET').toUpperCase();
  const rawBody = (init && init.body) || null;
  const entryRecord = {seq: ++shim.seq, at: new Date().toISOString(), url, method, body: rawBody,
    requestId: parseRequestId(typeof rawBody === 'string' ? rawBody : null)};
  if (shim.capped.requests !== null) {
    shim.capped.dropped += 1;
  } else if (shim.requests.length >= CAPS.requests) {
    shim.capped.requests = entryRecord.seq;
    shim.capped.dropped = 0;
    shim.requests.push({seq: entryRecord.seq, at: entryRecord.at, url: '__CAPPED_REQUESTS__', method: 'INFO', body: null});
  } else {
    if (typeof entryRecord.body === 'string' && entryRecord.body.length > CAPS.bodyBytes) {
      entryRecord.body = entryRecord.body.slice(0, CAPS.bodyBytes);
      entryRecord.bodyTruncated = true;
      shim.capped.bodyEntries += 1;
    }
    shim.requests.push(entryRecord);
  }
  return entryRecord;
}
async function respond(record) {
  const route = shim.routes.find(candidate => candidate.method === record.method && candidate.match.test(record.url));
  if (!route) return respondWith(500, JSON.stringify({error: 'FIXTURE_NO_HANDLER'}), 'application/json');
  route.count += 1;
  if (route.mode === 'defer') {
    const key = route.key + '#' + route.count;
    return new Promise(resolve => { shim.pending.set(key, resolve); });
  }
  if (route.mode === 'scripted') {
    const next = (route.queue || []).shift();
    if (!next) return respondWith(route.afterEmpty ?? 500, JSON.stringify({error: 'FIXTURE_SCRIPT_EMPTY'}), 'application/json');
    return respondWith(next.status, next.body, next.contentType);
  }
  return respondWith(route.status ?? 200, route.body ?? JSON.stringify({}), route.contentType);
}
// Requests fired before the scenario ordered the routes are held (their promise
// stays pending) and replayed, in order, once the first setRoutes arrives.
window.fetch = function fixtureFetch(input, init) {
  const entryRecord = record(input, init);
  if (!shim.configured) {
    return new Promise(resolve => { shim.buffer.push({record: entryRecord, resolve}); });
  }
  return respond(entryRecord);
};
shim.setRoutes = list => {
  shim.routes = (list || []).map(route => Object.assign({}, route, {match: new RegExp(route.pattern), count: route.count || 0}));
  shim.configured = true;
  const held = shim.buffer.splice(0);
  for (const item of held) { Promise.resolve(respond(item.record)).then(item.resolve).catch(cause => item.resolve(respondWith(500, JSON.stringify({error: 'FIXTURE_HOLD_REPLAY_FAILED', cause: String(cause)}), 'application/json'))); }
};
shim.requestsSnapshot = () => JSON.parse(JSON.stringify(shim.requests));
shim.capsSnapshot = () => JSON.parse(JSON.stringify({limits: CAPS, capped: shim.capped}));
shim.routeCounts = () => shim.routes.map(route => ({pattern: route.pattern, method: route.method, count: route.count, mode: route.mode}));
shim.deferredKeys = () => Array.from(shim.pending.keys());
shim.resolveDeferred = (key, answer) => {
  const target = Array.from(shim.pending.keys()).find(candidate => candidate === key || candidate.startsWith(key + '#'));
  if (!target || !shim.pending.has(target)) return {found: false, keys: Object.keys(shim.pending)};
  const resolve = shim.pending.get(target);
  shim.pending.delete(target);
  resolve(respondWith(answer.status, answer.body, answer.contentType));
  return {found: true, key: target};
};
window.__shim = shim;
export {};
`;


const NEXT_NAVIGATION = `
const log = [];
const state = {refreshImpl: () => {}, replaceImpl: (url) => { history.replaceState(history.state, '', url); }};
export const __navFixture = {
  log: () => JSON.parse(JSON.stringify(log)),
  setRefresh: impl => { state.refreshImpl = impl; },
  setReplace: impl => { state.replaceImpl = impl; },
};
// Next.js contract: useRouter() returns a stable AppRouterInstance identity
// across renders of the same page. A fresh object per render feeds identity
// into consumer useCallback/useEffect dependency chains and caused an
// unbounded fixture-side refetch cyclone (11k+ thread GETs within seconds).
const routerInstance = {
  replace: (url, opts) => { log.push(['replace', url, opts || null]); state.replaceImpl(url, opts); },
  push: url => { log.push(['push', url]); history.pushState(history.state, '', url); },
  refresh: () => { log.push(['refresh']); state.refreshImpl(); },
  back: () => { log.push(['back']); history.back(); },
  forward: () => { log.push(['forward']); history.forward(); },
  prefetch: () => { log.push(['prefetch']); },
};
export function useRouter() { return routerInstance; }
export function usePathname() { return window.location.pathname; }
let searchParamsSnapshot = null;
export function useSearchParams() {
  const current = window.location.search;
  if (searchParamsSnapshot === null || searchParamsSnapshot.source !== current) {
    searchParamsSnapshot = { source: current, searchParams: new URLSearchParams(current) };
  }
  return searchParamsSnapshot.searchParams;
}
export function useParams() { return {}; }
export default {useRouter, usePathname, useSearchParams, useParams, __navFixture};
`;

const NEXT_LINK = `
const React = window.__YRU_REACT__;
export default function Link({href, children, ...rest}) {
  return React.createElement('a', {href, ...rest}, children);
}
`;

const SUPABASE_FIXTURE = `
const channels = new Map();
const removed = [];
function createBrowserClient() {
  return {
    channel(name, options) {
      const ch = {
        name,
        config: (options && options.config) || {},
        broadcastHandlers: {},
        statusHandler: null,
        setStatus(status) { if (this.statusHandler) this.statusHandler(status); },
        fireInvalidate() { const handler = this.broadcastHandlers['broadcast:invalidate']; if (handler) handler({event: 'invalidate'}); },
      };
      channels.set(name, ch);
      return {
        // Mirror the real supabase-js contract: the object handed to the
        // application IS the channel and removeChannel must resolve back to the
        // registered one, so cleanup bookkeeping records the true name.
        name,
        __channel: ch,
        on(type, filter, callback) { ch.broadcastHandlers[type + ':' + ((filter && filter.event) || '')] = callback; return this; },
        subscribe(statusHandler) { ch.statusHandler = statusHandler; return this; },
      };
    },
    removeChannel(fake) {
      const real = (fake && fake.__channel) || fake;
      channels.delete((real && real.name) || null);
      removed.push((real && real.name) || null);
    },
  };
}
window.__supabaseFixture = {
  channels: () => [...channels.values()],
  channel: name => channels.get(name) || null,
  removed: () => [...removed],
};
export {createBrowserClient};
`;

export function startServer(port) {
  return new Promise((resolve, reject) => {
    const listening = server.listen(port, '127.0.0.1');
    listening.once('listening', () => resolve(server));
    listening.once('error', reject);
  });
}

export function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}
