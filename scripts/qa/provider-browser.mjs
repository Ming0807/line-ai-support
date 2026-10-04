import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Client } from 'pg';

const require = createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH
  ? resolve(process.env.PLAYWRIGHT_RUNTIME_PATH, 'package.json')
  : import.meta.url);
const { chromium } = require('playwright');

const browserTarget = new URL(process.env.APP_BASE_URL ?? 'http://127.0.0.1:3001');
const localDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const roleLabels = { SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด', STAFF: 'บุคลากร' };
const cases = [];
const tracked = { providers: [], models: [], authUsers: [], profiles: [] };
let pg;
let browser;
let stage = 'target_preflight';
let providerFixtureNameReserved = false;

function requireCheck(condition, code) {
  if (!condition) throw new Error(code);
}

function record(name) {
  cases.push({ name, passed: true });
}

requireCheck(['localhost', '127.0.0.1'].includes(browserTarget.hostname), 'LOCAL_BROWSER_TARGET_REQUIRED');
requireCheck(browserTarget.protocol === 'http:' && browserTarget.port === '3001'
  && !browserTarget.username && !browserTarget.password && browserTarget.pathname === '/', 'LOCAL_PRODUCTION_SERVER_REQUIRED');
const dbTarget = new URL(localDatabaseUrl);
requireCheck(['localhost', '127.0.0.1'].includes(dbTarget.hostname) && dbTarget.port === '54422'
  && dbTarget.pathname === '/postgres', 'LOCAL_DATABASE_TARGET_REQUIRED');

const credentialsPath = resolve('.superpowers/staging/dev-staff-credentials.json');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
requireCheck(typeof process.env.DEV_SUPABASE_PROJECT_REF === 'string'
  && credentials.projectRef === process.env.DEV_SUPABASE_PROJECT_REF, 'DEVELOPMENT_PROJECT_MISMATCH');
requireCheck(Array.isArray(credentials.accounts) && credentials.accounts.length === 3, 'DEVELOPMENT_ACCOUNT_SET_INVALID');

const admin = credentials.accounts.find(account => account.role === 'SUPER_ADMIN');
const itAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'IT');
const libraryAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'LIBRARY');
const accounts = [admin, itAccount, libraryAccount];
requireCheck(accounts.every(account => account && typeof account.id === 'string' && typeof account.email === 'string'
  && typeof account.password === 'string' && typeof account.displayName === 'string'), 'DEVELOPMENT_ACCOUNT_FIELDS_INVALID');
requireCheck(new Set(accounts.map(account => account.id)).size === 3, 'DEVELOPMENT_ACCOUNT_IDS_NOT_UNIQUE');

const prefix = `M5 QA ${randomBytes(4).toString('hex')}`;
const providerName = `${prefix} OpenAI provider`;
const initialApiKey = `sk-${randomBytes(28).toString('hex')}`;
const rotatedApiKey = `sk-${randomBytes(28).toString('hex')}`;
const providerValues = {
  name: providerName,
  adapter: 'OPENAI',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  priority: 43,
};
const modelValues = {
  modelId: `${prefix.replace(/ /g, '_')}_model`,
  displayName: `${prefix} Model Alpha`,
  supportsTools: true,
  supportsJson: true,
  supportsVision: false,
  enabled: true,
  priority: 61,
  timeoutMs: 17000,
  inputPricePerMillion: 1.25,
  outputPricePerMillion: 4.5,
};
const changedModelValues = {
  ...modelValues,
  displayName: `${prefix} Model Updated`,
  supportsVision: true,
  enabled: false,
  priority: 19,
  timeoutMs: 23000,
  inputPricePerMillion: 2.5,
  outputPricePerMillion: 7.75,
};
const profileIds = new Map();
const departmentIds = new Map();
let providerRevision;
let modelRevision;
let originalCipher;

async function createLocalProfiles() {
  const nameExists = (await pg.query('select exists(select 1 from private.ai_providers where name=$1) as exists', [providerName])).rows[0].exists;
  requireCheck(nameExists === false, 'PROVIDER_FIXTURE_NAME_ALREADY_EXISTS');
  providerFixtureNameReserved = true;
  await pg.query('begin');
  try {
    for (const code of ['IT', 'LIBRARY']) {
      const department = (await pg.query('select id,active from public.departments where code=$1', [code])).rows[0];
      requireCheck(department?.active === true, 'LOCAL_DEPARTMENT_MIRROR_MISSING');
      departmentIds.set(code, department.id);
    }
    for (const account of accounts) {
      const exists = (await pg.query(
        'select exists(select 1 from auth.users where id=$1) or exists(select 1 from public.staff_profiles where id=$1) as exists',
        [account.id],
      )).rows[0].exists;
      requireCheck(exists === false, 'LOCAL_AUTH_PROFILE_ALREADY_EXISTS');
      await pg.query('insert into auth.users(id) values($1)', [account.id]);
      tracked.authUsers.push(account.id);
      const departmentId = account.departmentCode ? departmentIds.get(account.departmentCode) : null;
      requireCheck(account.role === 'SUPER_ADMIN' ? departmentId === null : typeof departmentId === 'string', 'ACCOUNT_DEPARTMENT_INVALID');
      await pg.query(
        `insert into public.staff_profiles(id,department_id,role,display_name,active,can_view_sensitive,can_view_restricted)
         values($1,$2,$3,$4,true,false,false)`,
        [account.id, departmentId, account.role, account.displayName],
      );
      tracked.profiles.push(account.id);
      profileIds.set(account.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : account.departmentCode, account.id);
    }
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function readCipher() {
  const row = (await pg.query('select api_key_encrypted from private.ai_providers where id=$1', [tracked.providers[0]])).rows[0];
  requireCheck(typeof row?.api_key_encrypted === 'string' && row.api_key_encrypted.startsWith('v1.'), 'PROVIDER_CIPHER_MISSING');
  return row.api_key_encrypted;
}

async function cleanupFixtures() {
  if (!pg) return;
  await pg.query('begin');
  try {
    const ownProvider = providerFixtureNameReserved
      ? (await pg.query('select id from private.ai_providers where name=$1', [providerName])).rows[0]
      : null;
    if (ownProvider && !tracked.providers.includes(ownProvider.id)) tracked.providers.push(ownProvider.id);
    if (tracked.providers.length > 0) {
      const auditRows = (await pg.query(
        `select id from private.activities
         where actor_id=$1 and metadata->>'providerId'=any($2::text[])
           and action in ('AI_PROVIDER_CREATED','AI_PROVIDER_UPDATED','AI_MODEL_CREATED','AI_MODEL_UPDATED')`,
        [profileIds.get('SUPER_ADMIN') ?? admin.id, tracked.providers],
      )).rows;
      const auditIds = auditRows.map(row => row.id);
      await pg.query('delete from private.ai_errors where provider_id=any($1::uuid[])', [tracked.providers]);
      await pg.query('delete from private.ai_usage_logs where provider_id=any($1::uuid[])', [tracked.providers]);
      await pg.query('delete from private.activities where id=any($1::uuid[])', [auditIds]);
      await pg.query('delete from private.ai_models where provider_id=any($1::uuid[])', [tracked.providers]);
      await pg.query('delete from private.ai_providers where id=any($1::uuid[])', [tracked.providers]);
    }
    await pg.query('delete from public.staff_profiles where id=any($1::uuid[])', [tracked.profiles]);
    await pg.query('delete from auth.users where id=any($1::uuid[])', [tracked.authUsers]);
    await pg.query('commit');
  } catch {
    await pg.query('rollback').catch(() => undefined);
    throw new Error('FIXTURE_CLEANUP_FAILED');
  }
}

async function login(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto(new URL('/providers', browserTarget).href);
  await page.waitForURL(url => url.pathname === '/login');
  await page.getByLabel('อีเมลบุคลากร').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/dashboard' || url.pathname === '/providers', { timeout: 30_000 });
  const roleLine = await page.locator('.user-line').innerText();
  requireCheck(roleLine.includes(roleLabels[account.role]), 'SERVER_ROLE_NOT_RENDERED');
  await page.goto(new URL('/providers', browserTarget).href);
  return { context, page };
}

async function expectPrivateProviderPayload(context) {
  const response = await context.request.get(new URL('/api/providers', browserTarget).href);
  requireCheck(response.status() === 200, 'PROVIDER_LIST_API_FAILED');
  const body = await response.text();
  requireCheck(!body.includes(initialApiKey) && !body.includes(rotatedApiKey)
    && !/api_key_encrypted|apiKey\s*[:"]|ciphertext/i.test(body), 'PROVIDER_API_EXPOSED_KEY');
  const parsed = JSON.parse(body);
  const provider = parsed.providers?.find(item => item.id === tracked.providers[0]);
  requireCheck(provider && provider.keyConfigured === true, 'PROVIDER_LIST_SHAPE_INVALID');
  requireCheck(!Object.keys(provider).some(key => /api.?key|cipher/i.test(key)), 'PROVIDER_API_EXPOSED_KEY_FIELD');
  return provider;
}

async function submitAndCheck(page, responsePath, method, action, expectedStatus = 200, onBody) {
  const responsePromise = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname === responsePath);
  await action();
  const response = await responsePromise;
  requireCheck(response.status() === expectedStatus, 'PROVIDER_UI_WRITE_FAILED');
  const body = await response.text();
  requireCheck(!body.includes(initialApiKey) && !body.includes(rotatedApiKey)
    && !/api_key_encrypted|ciphertext/i.test(body), 'PROVIDER_WRITE_RESPONSE_EXPOSED_KEY');
  const parsed = JSON.parse(body);
  onBody?.(parsed);
  return parsed;
}

async function assertMobileFit(page) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  requireCheck(dimensions.document <= dimensions.client + 1 && dimensions.body <= dimensions.client + 1, 'MOBILE_PROVIDER_OVERFLOW');
}

async function runBrowserCases() {
  stage = 'unauthenticated_access';
  const anonymous = await browser.newContext();
  const anonymousResponse = await anonymous.request.get(new URL('/api/providers', browserTarget).href);
  requireCheck(anonymousResponse.status() === 401, 'UNAUTHENTICATED_PROVIDER_API_NOT_DENIED');
  const anonymousPage = await anonymous.newPage();
  const anonymousPageResponse = await anonymousPage.goto(new URL('/providers', browserTarget).href);
  await anonymousPage.waitForURL(url => url.pathname === '/login');
  requireCheck(anonymousPageResponse?.status() === 200, 'UNAUTHENTICATED_PROVIDER_PAGE_DID_NOT_REDIRECT');
  await anonymous.close();
  record('anonymous_api_401_and_page_login_redirect');

  stage = 'super_admin_login';
  const superSession = await login(admin);
  await superSession.page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).waitFor();
  const apiPage = await superSession.context.request.get(new URL('/api/providers', browserTarget).href);
  requireCheck(apiPage.status() === 200, 'SUPER_ADMIN_PROVIDER_API_DENIED');
  record('super_admin_provider_page_and_api_access');

  stage = 'create_provider';
  const createForm = superSession.page.locator('.provider-add-panel form');
  await createForm.getByLabel('ชื่อผู้ให้บริการ').fill(providerName);
  await createForm.locator('[name="priority"]').fill(String(providerValues.priority));
  await createForm.getByLabel('API key').fill(initialApiKey);
  const created = await submitAndCheck(superSession.page, '/api/providers', 'POST',
    () => createForm.getByRole('button', { name: 'เพิ่มผู้ให้บริการ', exact: true }).click(), 200,
    result => { if (typeof result.id === 'string') tracked.providers.push(result.id); });
  requireCheck(typeof created.id === 'string' && Number.isInteger(created.revision), 'PROVIDER_CREATE_RESPONSE_INVALID');
  providerRevision = created.revision;
  await superSession.page.getByRole('heading', { name: providerName, exact: true }).waitFor();
  await superSession.page.locator('#new-provider-key').waitFor();
  requireCheck(await superSession.page.locator('#new-provider-key').inputValue() === '', 'PROVIDER_CREATE_KEY_NOT_CLEARED');
  originalCipher = await readCipher();
  requireCheck(originalCipher !== initialApiKey && !originalCipher.includes(initialApiKey), 'PROVIDER_SECRET_NOT_ENCRYPTED');
  const firstProvider = superSession.page.locator('.provider-card').filter({ has: superSession.page.getByRole('heading', { name: providerName, exact: true }) });
  const rendered = await firstProvider.innerText();
  requireCheck(!rendered.includes(initialApiKey) && !rendered.includes(originalCipher), 'PROVIDER_SECRET_RENDERED');
  record('create_provider_encrypt_key_clear_field_and_hide_key');

  stage = 'create_model';
  await firstProvider.locator('.provider-add-model > summary').click();
  const addModel = firstProvider.locator('.provider-add-model .model-form');
  await addModel.locator('[name="modelId"]').fill(modelValues.modelId);
  await addModel.locator('[name="displayName"]').fill(modelValues.displayName);
  await addModel.locator('[name="priority"]').fill(String(modelValues.priority));
  await addModel.locator('[name="timeoutMs"]').fill(String(modelValues.timeoutMs));
  await addModel.locator('[name="inputPricePerMillion"]').fill(String(modelValues.inputPricePerMillion));
  await addModel.locator('[name="outputPricePerMillion"]').fill(String(modelValues.outputPricePerMillion));
  await addModel.locator('[name="supportsTools"]').check();
  await addModel.locator('[name="supportsJson"]').check();
  const modelCreated = await submitAndCheck(superSession.page, `/api/providers/${created.id}/models`, 'POST',
    () => addModel.getByRole('button', { name: 'เพิ่ม Model', exact: true }).click());
  requireCheck(typeof modelCreated.id === 'string' && Number.isInteger(modelCreated.revision), 'MODEL_CREATE_RESPONSE_INVALID');
  tracked.models.push(modelCreated.id);
  modelRevision = modelCreated.revision;
  await firstProvider.getByRole('heading', { name: modelValues.displayName, exact: true }).waitFor();
  record('create_model_priority_timeout_capabilities_and_prices');

  stage = 'edit_model';
  const modelCard = firstProvider.locator('.provider-model').filter({ has: superSession.page.getByRole('heading', { name: modelValues.displayName, exact: true }) });
  await modelCard.locator('.provider-edit-model > summary').click();
  const editModel = modelCard.locator('.provider-edit-model .model-form');
  await editModel.locator('[name="displayName"]').fill(changedModelValues.displayName);
  await editModel.locator('[name="priority"]').fill(String(changedModelValues.priority));
  await editModel.locator('[name="timeoutMs"]').fill(String(changedModelValues.timeoutMs));
  await editModel.locator('[name="inputPricePerMillion"]').fill(String(changedModelValues.inputPricePerMillion));
  await editModel.locator('[name="outputPricePerMillion"]').fill(String(changedModelValues.outputPricePerMillion));
  await editModel.locator('[name="supportsVision"]').check();
  await editModel.locator('[name="enabled"]').uncheck();
  const modelUpdate = await submitAndCheck(superSession.page, `/api/providers/${created.id}/models/${modelCreated.id}`, 'PATCH',
    () => editModel.getByRole('button', { name: 'บันทึก Model', exact: true }).click());
  requireCheck(Number.isInteger(modelUpdate.revision) && modelUpdate.revision > modelRevision, 'MODEL_REVISION_NOT_INCREMENTED');
  modelRevision = modelUpdate.revision;
  await firstProvider.getByRole('heading', { name: changedModelValues.displayName, exact: true }).waitFor();
  const model = await superSession.context.request.get(new URL('/api/providers', browserTarget).href);
  const modelBody = await model.json();
  const modelProvider = modelBody.providers?.find(item => item.id === created.id);
  const modelDto = modelProvider?.models?.find(item => item.id === modelCreated.id);
  requireCheck(model.status() === 200 && modelDto?.displayName === changedModelValues.displayName
    && modelDto.priority === changedModelValues.priority && modelDto.timeoutMs === changedModelValues.timeoutMs
    && modelDto.enabled === false && modelDto.supportsVision === true
    && modelDto.inputPricePerMillion === changedModelValues.inputPricePerMillion
    && modelDto.outputPricePerMillion === changedModelValues.outputPricePerMillion, 'MODEL_CONFIGURATION_READBACK_FAILED');
  record('edit_model_priority_timeout_enabled_capabilities_and_prices');

  stage = 'provider_keep_key';
  await superSession.page.reload();
  await superSession.page.getByRole('heading', { name: providerName, exact: true }).waitFor();
  const freshProvider = await expectPrivateProviderPayload(superSession.context);
  providerRevision = freshProvider.revision;
  const currentProviderCard = superSession.page.locator('.provider-card').filter({ has: superSession.page.getByRole('heading', { name: providerName, exact: true }) });
  const settings = currentProviderCard.locator('.provider-settings');
  await settings.locator('> summary').click();
  const settingsForm = settings.locator('.provider-settings-form');
  await settingsForm.getByLabel('ชื่อผู้ให้บริการ').fill(providerName);
  await settingsForm.locator('[name="priority"]').fill('37');
  requireCheck(await settingsForm.locator('[name="apiKey"]').inputValue() === '', 'PROVIDER_EDIT_KEY_NOT_BLANK');
  const keepResult = await submitAndCheck(superSession.page, `/api/providers/${created.id}`, 'PATCH',
    () => settingsForm.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click());
  requireCheck(Number.isInteger(keepResult.revision) && keepResult.revision > providerRevision, 'PROVIDER_REVISION_NOT_INCREMENTED');
  providerRevision = keepResult.revision;
  requireCheck(await readCipher() === originalCipher, 'PROVIDER_BLANK_KEY_CHANGED_CIPHER');
  record('blank_provider_key_keeps_saved_cipher');

  stage = 'rotate_provider_key';
  await superSession.page.reload();
  await superSession.page.getByRole('heading', { name: providerName, exact: true }).waitFor();
  const currentProvider = await expectPrivateProviderPayload(superSession.context);
  providerRevision = currentProvider.revision;
  const refreshedCard = superSession.page.locator('.provider-card').filter({ has: superSession.page.getByRole('heading', { name: providerName, exact: true }) });
  const refreshedSettings = refreshedCard.locator('.provider-settings');
  await refreshedSettings.locator('> summary').click();
  const refreshedSettingsForm = refreshedSettings.locator('.provider-settings-form');
  await refreshedSettingsForm.locator('[name="apiKey"]').fill(rotatedApiKey);
  const rotation = await submitAndCheck(superSession.page, `/api/providers/${created.id}`, 'PATCH',
    () => refreshedSettingsForm.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click());
  requireCheck(Number.isInteger(rotation.revision) && rotation.revision > providerRevision, 'PROVIDER_ROTATION_REVISION_INVALID');
  providerRevision = rotation.revision;
  const rotatedCipher = await readCipher();
  requireCheck(rotatedCipher !== originalCipher && !rotatedCipher.includes(rotatedApiKey), 'PROVIDER_ROTATION_CIPHER_INVALID');
  const healthState = (await pg.query('select health_status,last_health_check from private.ai_providers where id=$1', [created.id])).rows[0];
  requireCheck(healthState.health_status === 'UNKNOWN' && healthState.last_health_check === null, 'PROVIDER_ROTATION_DID_NOT_RESET_HEALTH');
  requireCheck(await refreshedSettingsForm.locator('[name="apiKey"]').inputValue() === '', 'PROVIDER_ROTATION_FIELD_NOT_CLEARED');
  record('provider_key_rotation_changes_cipher_clears_field_and_resets_health');

  stage = 'privacy_readback';
  await expectPrivateProviderPayload(superSession.context);
  const documentHtml = await superSession.page.content();
  requireCheck(!documentHtml.includes(initialApiKey) && !documentHtml.includes(rotatedApiKey)
    && !documentHtml.includes(originalCipher) && !documentHtml.includes(rotatedCipher), 'PROVIDER_KEY_VISIBLE_IN_HTML');
  const keyInputs = await superSession.page.locator('.provider-card input[name="apiKey"]').evaluateAll(inputs => inputs.map(input => ({
    type: input.type,
    value: input.value,
    placeholder: input.placeholder,
  })));
  requireCheck(keyInputs.length === 1 && keyInputs[0].type === 'password' && keyInputs[0].value === '', 'PROVIDER_KEY_INPUT_PRIVACY_INVALID');
  record('provider_cipher_and_plain_key_absent_from_html_and_api');

  stage = 'stale_revision';
  const stale = await superSession.context.request.patch(new URL(`/api/providers/${created.id}`, browserTarget).href, {
    data: { ...providerValues, name: providerName, revision: created.revision, apiKey: null },
    headers: { origin: browserTarget.origin },
  });
  requireCheck(stale.status() === 409, 'STALE_PROVIDER_REVISION_NOT_CONFLICT');
  requireCheck(await readCipher() === rotatedCipher, 'STALE_PROVIDER_WRITE_CHANGED_KEY');
  record('stale_provider_revision_returns_409');

  stage = 'foreign_origin';
  const foreign = await superSession.context.request.post(new URL('/api/providers', browserTarget).href, {
    data: { ...providerValues, name: `${prefix} blocked provider`, apiKey: initialApiKey },
    headers: { origin: 'https://untrusted.invalid' },
  });
  requireCheck(foreign.status() === 403, 'FOREIGN_ORIGIN_PROVIDER_WRITE_NOT_DENIED');
  const foreignCount = Number((await pg.query('select count(*)::int as count from private.ai_providers where name=$1', [`${prefix} blocked provider`])).rows[0].count);
  requireCheck(foreignCount === 0, 'FOREIGN_ORIGIN_PROVIDER_WAS_CREATED');
  record('foreign_origin_provider_write_returns_403');

  stage = 'ordinary_staff_denied';
  for (const account of [itAccount, libraryAccount]) {
    const session = await login(account);
    const response = await session.context.request.get(new URL('/api/providers', browserTarget).href);
    requireCheck(response.status() === 403, 'ORDINARY_STAFF_PROVIDER_API_NOT_DENIED');
    const healthResponse = await session.context.request.post(new URL(`/api/providers/${tracked.providers[0]}/health`, browserTarget).href, {
      data: { modelId: tracked.models[0] },
      headers: { origin: browserTarget.origin },
    });
    requireCheck(healthResponse.status() === 403, 'ORDINARY_STAFF_HEALTH_API_NOT_DENIED');
    const pageResponse = await session.page.goto(new URL('/providers', browserTarget).href);
    await session.page.waitForLoadState('domcontentloaded');
    requireCheck([200, 404].includes(pageResponse?.status()), 'ORDINARY_STAFF_PROVIDER_PAGE_INVALID_STATUS');
    requireCheck(await session.page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).count() === 0,
      'ORDINARY_STAFF_PROVIDER_PAGE_NOT_HIDDEN');
    requireCheck(await session.page.getByRole('heading', { name: providerName, exact: true }).count() === 0,
      'ORDINARY_STAFF_PROVIDER_FIXTURE_LEAKED');
    requireCheck(await session.page.getByRole('heading', {name: '404', exact: true}).count() === 1,
      'ORDINARY_STAFF_NOT_FOUND_NOT_RENDERED');
    await session.context.close();
  }
  record('it_and_library_provider_api_403_and_page_not_found');

  stage = 'mobile_layout';
  await superSession.page.setViewportSize({ width: 390, height: 844 });
  await superSession.page.goto(new URL('/providers', browserTarget).href);
  await superSession.page.getByRole('heading', { name: providerName, exact: true }).waitFor();
  await assertMobileFit(superSession.page);
  await mkdir(resolve('.superpowers/staging'), { recursive: true });
  await superSession.page.screenshot({ path: resolve('.superpowers/staging/m5-provider-mobile.png'), fullPage: true });
  record('mobile_390px_provider_page_no_horizontal_overflow');
  await superSession.context.close();
}

try {
  pg = new Client({ connectionString: localDatabaseUrl });
  await pg.connect();
  stage = 'fixture_setup';
  await createLocalProfiles();
  stage = 'browser_start';
  browser = await chromium.launch({ headless: true });
  await runBrowserCases();
  console.log(JSON.stringify({ stage: 'provider_browser_cases', cases }));
} catch (error) {
  const check = typeof error?.message === 'string' && /^[A-Z_0-9]{1,100}$/.test(error.message) ? error.message : 'RUNNER_ERROR';
  const errorType = typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
  console.error(JSON.stringify({ code: 'PROVIDER_BROWSER_RUN_FAILED', stage, errorType, check }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => { process.exitCode = 1; });
  stage = 'fixture_cleanup';
  try {
    await cleanupFixtures();
  } catch {
    console.error(JSON.stringify({ code: 'PROVIDER_FIXTURE_CLEANUP_FAILED', stage }));
    process.exitCode = 1;
  }
  if (pg) await pg.end().catch(() => { process.exitCode = 1; });
}
