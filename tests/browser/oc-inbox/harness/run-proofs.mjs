/**
 * OC-INBOX-05 browser-proof runner (commit 4, plan §8 item 4).
 *
 * Mirrors run-scenarios.mjs plumbing (same fixture server, same machine-local
 * Edge via Playwright with a harness-only profile) but drives the PROOF list
 * and captures IN-FLOW screenshots at decisive moments. Screenshots are
 * written to SCREENSHOT_DIR — OUTSIDE the repository (plan §5); the committed
 * evidence stays JSON/MD (no binaries) and records the screenshot file names.
 *
 * Usage: node tests/browser/oc-inbox/harness/run-proofs.mjs [--label=browser-proofs] [proof-id ...]
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import {createRequire} from 'node:module';

import {ARTIFACTS_DIR, proofs} from './proofs.mjs';
import {startServer, closeServer} from './server.mjs';

const args = process.argv.slice(2);
const labelArg = args.find(item => item.startsWith('--label='));
const label = labelArg ? String(labelArg.slice('--label='.length)) : 'browser-proofs';
const wanted = args.filter(item => !item.startsWith('--'));

const PLAYWRIGHT_PACKAGE = process.env.PLAYWRIGHT_PACKAGE_PATH
  || 'C:/Users/NOTEBOOK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const PROFILE_DIR = 'D:/codex-cache/yru-ui-qa/oc-inbox-05-profile-' + label;
// Screenshots intentionally outside the repository (plan §5): real browser
// output never becomes part of the repo tree.
const SCREENSHOT_DIR = process.env.OC_INBOX_SCREENSHOT_DIR || 'D:/codex-cache/yru-ui-qa/oc-inbox-05-artifacts/' + label;
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
    ? proofs.filter(proof => wanted.some(id => proof.id.startsWith(id) || id === proof.id))
    : proofs;
  if (selected.length === 0) {
    console.error('NO_PROOF_SELECTED: ' + JSON.stringify(wanted));
    await closeServer(server);
    process.exit(2);
  }

  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: true,
  });

  const results = [];
  for (const proof of selected) {
    results.push(await driveProof(playwright, context, proof, port));
  }

  await context.close();
  await closeServer(server);

  const overall = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    serverPort: port,
    playwrightPackage: PLAYWRIGHT_PACKAGE,
    screenshotsDir: SCREENSHOT_DIR,
    results,
    failed: results.filter(item => !item.ok).length,
    passed: results.filter(item => item.ok).length,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(overall, null, 2) + '\n');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.md'), transcriptMarkdown(overall));

  for (const line of overall.results) {
    console.log(`${line.ok ? 'OK  ' : 'FAIL'} ${line.id} — ${line.checks.filter(item => item.pass).length}/${line.checks.length} checks · ${line.screenshots.length} shots${line.error ? ' · aborted: ' + line.error : ''}`);
  }
  console.log(`PROOF ${label}: ${overall.passed} OK / ${overall.failed} FAIL → evidence ${EVIDENCE_DIR} · shots ${SCREENSHOT_DIR}`);
  process.exitCode = overall.failed > 0 ? 1 : 0;
}

async function driveProof(_playwright, context, proof, port) {
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const screenshots = [];
  page.on('console', message => { consoleMessages.push({type: message.type(), text: message.text().slice(0, 500)}); });
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error).slice(0, 1200)));

  const checks = [];
  const check = (pass, text, detail) => {
    checks.push({pass: Boolean(pass), text, detail: safeJson(detail)});
  };
  // In-flow captures: the label the fixture prints carries the FIXTURE marker,
  // so every screenshot is visibly fixture-labelled (plan §5).
  const shot = async name => {
    const file = `${proof.id}-${String(screenshots.length + 1).padStart(2, '0')}-${name}.png`;
    try {
      await page.screenshot({path: path.join(SCREENSHOT_DIR, file), fullPage: true});
      screenshots.push({file, dir: SCREENSHOT_DIR});
    } catch (caught) {
      screenshots.push({file, dir: SCREENSHOT_DIR, error: String(caught && caught.message || caught)});
    }
  };

  const started = new Date().toISOString();
  let error = null;
  let stepError = null;
  try {
    await page.setViewportSize(proof.viewport);
    await proof.run(page, port, check, shot);
  } catch (caught) {
    stepError = String(caught && caught.stack || caught).slice(0, 1200);
    error = (caught && caught.message || String(caught));
    pageErrors.push(stepError);
  } finally {
    if (stepError) {
      try {
        await page.screenshot({path: `${SCREENSHOT_DIR}/${label}-${proof.id}-FAIL.png`, fullPage: true});
      } catch { /* best-effort evidence only */ }
    }
    await page.close().catch(() => {});
    const result = {
      label,
      id: proof.id,
      title: proof.title,
      viewport: proof.viewport,
      startedAt: started,
      ok: !stepError && checks.length > 0 && checks.every(item => item.pass),
      error,
      checks,
      screenshots,
      consoleMessages,
      pageErrors,
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, proof.id + '.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  }
}

function transcriptMarkdown(overall) {
  const lines = [
    `# OC-INBOX-05 browser proofs — ${overall.label}`,
    '',
    `- Started: ${overall.startedAt} · Finished: ${overall.finishedAt} (server 127.0.0.1:${overall.serverPort}, FIXTURE only)`,
    `- Playwright: ${overall.playwrightPackage} · channel msedge · headless · profile and screenshots OUTSIDE the repository`,
    `- Screenshots directory: ${overall.screenshotsDir} (stored outside the repository; not part of the repo tree)`,
    `- Result: ${overall.passed} OK / ${overall.failed} FAIL`,
    '',
    '| Proof | Check | Verdict | Detail (truncated) |',
    '|---|---|---|---|',
  ];
  for (const result of overall.results) {
    lines.push(`| ${result.id}${result.ok ? '' : ' (aborted: ' + short(result.error) + ')'} | title | ${result.ok ? 'OK' : 'FAIL'} | ${short(result.title)} |`);
    for (const item of result.checks) {
      lines.push(`| ${result.id} | ${short(item.text)} | ${item.pass ? 'OK' : 'FAIL'} | ${short(item.detail)} |`);
    }
    for (const image of result.screenshots) {
      lines.push(`| ${result.id} | screenshot | — | ${short(image.file)}${image.error ? ' (capture failed: ' + short(image.error) + ')' : ''} |`);
    }
  }
  lines.push('');
  const failures = overall.results.flatMap(result => result.pageErrors);
  if (failures.length > 0) {
    lines.push('## Page errors / aborts', '');
    for (const failure of failures) lines.push('- ' + failure.replace(/\n+/g, ' | ').slice(0, 600));
    lines.push('');
  }
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
  console.error('PROOF_RUNNER_CRASH ' + (error && error.stack || error));
  process.exit(3);
});
