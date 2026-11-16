/**
 * OC-INBOX-05 scenario runner (FIXTURE HARNESS — tests only; no production wiring).
 *
 * Starts the fixture server (server.mjs, compiled production components) on a free
 * 127.0.0.1 port chosen at runtime, opens the machine-local bundled Microsoft Edge
 * through Playwright with a harness-only profile, and drives each mounted scenario
 * on its own page. Structured evidence goes to tests/browser/oc-inbox/artifacts/<label>/
 * (JSON per scenario + combined markdown transcript); failure screenshots go outside
 * the repository (OC_INBOX_SCREENSHOT_DIR). The process exits non-zero when any
 * scenario fails, so gates can rely on the exit code.
 *
 * Usage: node tests/browser/oc-inbox/harness/run-scenarios.mjs [--label=red] [scenario-id ...]
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

import {ARTIFACTS_DIR, scenarios} from './scenarios.mjs';
import {startServer, closeServer} from './server.mjs';

const args = process.argv.slice(2);
const labelArg = args.find(item => item.startsWith('--label='));
const label = labelArg ? String(labelArg.slice('--label='.length)) : 'red';
const wanted = args.filter(item => !item.startsWith('--'));

const PLAYWRIGHT_PACKAGE = process.env.PLAYWRIGHT_PACKAGE_PATH
  || 'C:/Users/NOTEBOOK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const PROFILE_DIR = 'D:/codex-cache/yru-ui-qa/oc-inbox-05-profile-' + label;
const SCREENSHOT_DIR = process.env.OC_INBOX_SCREENSHOT_DIR || 'D:/codex-cache/yru-ui-qa/oc-inbox-05-artifacts/' + label;

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = ARTIFACTS_DIR + '/' + label;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function main() {
  for (const dir of [PROFILE_DIR, SCREENSHOT_DIR, EVIDENCE_DIR]) fs.mkdirSync(dir, {recursive: true});

  const nodeRequire = createRequire(PLAYWRIGHT_PACKAGE);
  const playwright = nodeRequire('playwright');
  const port = await freePort();
  const server = await startServer(port);
  const startedAt = new Date().toISOString();

  const selected = wanted.length > 0
    ? scenarios.filter(scenario => wanted.some(id => scenario.id.startsWith(id) || id === scenario.id))
    : scenarios;
  if (selected.length === 0) {
    console.error('NO_SCENARIO_SELECTED: ' + JSON.stringify(wanted));
    await closeServer(server);
    process.exit(2);
  }

  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: true,
  });

  const results = [];
  for (const scenario of selected) {
    const result = await driveScenario(playwright, context, scenario, port, label);
    results.push(result);
  }

  await context.close();
  await closeServer(server);

  const timestamp = new Date().toISOString();
  const overall = {
    label,
    startedAt,
    finishedAt: timestamp,
    serverPort: port,
    playwrightPackage: PLAYWRIGHT_PACKAGE,
    results,
    failed: results.filter(item => !item.ok).length,
    passed: results.filter(item => item.ok).length,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(overall, null, 2) + '\n');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.md'), transcriptMarkdown(overall));

  for (const line of overall.results) {
    console.log(`${line.ok ? 'OK  ' : 'FAIL'} ${line.id} — ${line.checks.filter(item => item.pass).length}/${line.checks.length} checks${line.capped ? ' · CAPPED: ' + line.capped : ''}${line.error ? ' · aborted: ' + line.error : ''}`);
  }
  console.log(`RUN ${label}: ${overall.passed} OK / ${overall.failed} FAIL → ${EVIDENCE_DIR}`);
  process.exitCode = overall.failed > 0 ? 1 : 0;
}

async function driveScenario(_playwright, context, scenario, port, label) {
  const page = await context.newPage();
  // OP06-10 bounded evidence: console/page-error capture is capped per
  // scenario; overflowing a cap marks the scenario CAPPED (a failure) so the
  // run fails fast with a compact summary instead of silently growing logs.
  const CAPS = {console: 120, pageErrors: 50};
  const consoleMessages = [];
  const pageErrors = [];
  const caps = {console: null, pageErrors: null};
  const onConsole = message => {
    if (consoleMessages.length >= CAPS.console) {
      if (caps.console === null) caps.console = consoleMessages.length;
      return;
    }
    consoleMessages.push({type: message.type(), text: message.text().slice(0, 500)});
  };
  const onPageError = error => {
    if (pageErrors.length >= CAPS.pageErrors) {
      if (caps.pageErrors === null) caps.pageErrors = pageErrors.length;
      return;
    }
    pageErrors.push(String(error && error.stack || error).slice(0, 1200));
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const checks = [];
  const check = (pass, text, detail) => {
    checks.push({pass: Boolean(pass), text, detail: safeJson(detail)});
  };

  const started = new Date().toISOString();
  let error = null;
  let stepError = null;
  try {
    await page.setViewportSize(scenario.viewport);
    await scenario.run(page, port, check);
  } catch (caught) {
    stepError = String(caught && caught.stack || caught).slice(0, 1200);
    error = (caught && caught.message || String(caught));
    pageErrors.push(stepError);
  } finally {
    const requestsSnapshot = await page.evaluate(() => (window.__shim ? window.__shim.requestsSnapshot() : null)).catch(() => null);
    const routeCounts = await page.evaluate(() => (window.__shim ? window.__shim.routeCounts() : null)).catch(() => null);
    const shimCaps = await page.evaluate(() => (window.__shim && window.__shim.capsSnapshot ? window.__shim.capsSnapshot() : null)).catch(() => null);
    const finalText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : null).catch(() => null);
    if (stepError) {
      try {
        await page.screenshot({path: `${SCREENSHOT_DIR}/${label}-${scenario.id}-FAIL.png`});
      } catch { /* The screenshot is best-effort evidence only. */ }
    }
    await page.close().catch(() => {});
    const capped = caps.console !== null || caps.pageErrors !== null || (shimCaps && shimCaps.capped && (shimCaps.capped.requests !== null || shimCaps.capped.bodyEntries > 0)) || null;
    // eslint-disable-next-line no-useless-assignment
    const result = {
      label,
      id: scenario.id,
      title: scenario.title,
      viewport: scenario.viewport,
      startedAt: started,
      ok: !stepError && !capped && checks.length > 0 && checks.every(item => item.pass),
      capped: cappedMarker(caps, shimCaps),
      error,
      checks,
      consoleMessages,
      pageErrors,
      requestsSnapshot,
      routeCounts,
      finalText,
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, scenario.id + '.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  }
}

function cappedMarker(caps, shimCaps) {
  const markers = [];
  if (caps.console !== null) markers.push(`console>${caps.console}`);
  if (caps.pageErrors !== null) markers.push(`pageErrors>${caps.pageErrors}`);
  if (shimCaps && shimCaps.capped && shimCaps.capped.requests !== null) markers.push(`requests>${shimCaps.capped.requests}(dropped:${shimCaps.capped.dropped})`);
  if (shimCaps && shimCaps.capped && shimCaps.capped.bodyEntries > 0) markers.push(`bodies>16KiB(${shimCaps.capped.bodyEntries})`);
  return markers.length > 0 ? markers.join(';') : null;
}

function transcriptMarkdown(overall) {
  const lines = [
    `# OC-INBOX-05 mounted-scenario run — ${overall.label}`,
    '',
    `- Started: ${overall.startedAt} · Finished: ${overall.finishedAt} (server 127.0.0.1:${overall.serverPort}, FIXTURE only)`,
    `- Playwright: ${overall.playwrightPackage} · channel msedge · headless persistent profile outside the repository`,
    `- Result: ${overall.passed} OK / ${overall.failed} FAIL`,
    '',
    '| Scenario | Check | Verdict | Detail (truncated) |',
    '|---|---|---|---|',
  ];
  for (const result of overall.results) {
    lines.push(`| ${result.id}${result.ok ? '' : ' (aborted: ' + short(result.error) + ')'} | title | ${result.ok ? 'OK' : 'FAIL'} | ${short(result.title)} |`);
    for (const item of result.checks) {
      lines.push(`| ${result.id} | ${short(item.text)} | ${item.pass ? 'OK' : 'FAIL'} | ${short(item.detail)} |`);
    }
  }
  lines.push('');
  const failures = overall.results.flatMap(result => result.pageErrors);
  if (failures.length > 0) {
    lines.push('## Page errors / aborts', '');
    for (const failure of failures) lines.push('- ' + failure.replace(/\n+/g, ' | ').slice(0, 600));
    lines.push('');
  }
  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

function short(text, limit = 160) {
  if (text === undefined || text === null) return '';
  return String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, limit);
}

function safeJson(detail) {
  if (detail === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(detail, (_key, value) => (typeof value === 'function' ? String(value) : value)));
  } catch {
    return String(detail);
  }
}

main().catch(error => {
  console.error('RUNNER_CRASH ' + (error && error.stack || error));
  process.exit(3);
});
