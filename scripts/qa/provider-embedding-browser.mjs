import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Client } from 'pg';

const require = createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH
  ? resolve(process.env.PLAYWRIGHT_RUNTIME_PATH, 'package.json')
  : import.meta.url);
const { chromium } = require('playwright');

const base = new URL(process.env.APP_BASE_URL ?? 'http://127.0.0.1:3001');
const localDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const roleLabels = { SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด', STAFF: 'บุคลากร' };
const cases = [];
const tracked = { providers: [], profiles: [], authUsers: [] };
let pg;
let browser;
let stage = 'environment_preflight';
let providerName;
let fixtureNameReserved = false;
let accounts = [];
let admin;
let itAccount;
let libraryAccount;
let fixtureSecret;

function requireCheck(condition, code) {
  if (!condition) throw new Error(code);
}

function record(name) {
  cases.push({ name, passed: true });
}

async function createLocalProfiles() {
  const nameExists = (await pg.query('select exists(select 1 from private.ai_providers where name=$1) as exists', [providerName])).rows[0].exists;
  requireCheck(nameExists === false, 'PROVIDER_FIXTURE_NAME_ALREADY_EXISTS');
  fixtureNameReserved = true;
  await pg.query('begin');
  try {
    const departments = new Map();
    for (const code of ['IT', 'LIBRARY']) {
      const department = (await pg.query('select id,active from public.departments where code=$1', [code])).rows[0];
      requireCheck(department?.active === true, 'LOCAL_DEPARTMENT_MIRROR_MISSING');
      departments.set(code, department.id);
    }
    for (const account of accounts) {
      const existing = (await pg.query(
        'select exists(select 1 from auth.users where id=$1) or exists(select 1 from public.staff_profiles where id=$1) as exists',
        [account.id],
      )).rows[0].exists;
      requireCheck(existing === false, 'LOCAL_AUTH_PROFILE_ALREADY_EXISTS');
      await pg.query('insert into auth.users(id) values($1)', [account.id]);
      tracked.authUsers.push(account.id);
      const departmentId = account.departmentCode ? departments.get(account.departmentCode) : null;
      requireCheck(account.role === 'SUPER_ADMIN' ? departmentId === null : typeof departmentId === 'string', 'ACCOUNT_DEPARTMENT_INVALID');
      await pg.query(
        `insert into public.staff_profiles(id,department_id,role,display_name,active,can_view_sensitive,can_view_restricted)
         values($1,$2,$3,$4,true,false,false)`,
        [account.id, departmentId, account.role, account.displayName],
      );
      tracked.profiles.push(account.id);
    }
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function cleanupFixtures() {
  if (!pg) return;
  await pg.query('begin');
  try {
    const ownProvider = fixtureNameReserved
      ? (await pg.query('select id from private.ai_providers where name=$1', [providerName])).rows[0]
      : null;
    if (ownProvider && !tracked.providers.includes(ownProvider.id)) tracked.providers.push(ownProvider.id);
    if (tracked.providers.length > 0) {
      const auditRows = (await pg.query(
        `select id from private.activities where actor_id=$1 and metadata->>'providerId'=any($2::text[])
         and action in ('AI_PROVIDER_CREATED','AI_MODEL_CREATED','AI_MODEL_UPDATED')`,
        [admin.id, tracked.providers],
      )).rows;
      await pg.query('delete from private.ai_errors where provider_id=any($1::uuid[])', [tracked.providers]);
      await pg.query('delete from private.ai_usage_logs where provider_id=any($1::uuid[])', [tracked.providers]);
      await pg.query('delete from private.activities where id=any($1::uuid[])', [auditRows.map(row => row.id)]);
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
  const runtime = { pageError: false };
  page.on('pageerror', () => { runtime.pageError = true; });
  await page.goto(new URL('/providers', base).href);
  await page.waitForURL(url => url.pathname === '/login');
  await page.getByLabel('อีเมลบุคลากร').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/dashboard' || url.pathname === '/providers', { timeout: 30_000 });
  requireCheck((await page.locator('.user-line').innerText()).includes(roleLabels[account.role]), 'SERVER_ROLE_NOT_RENDERED');
  await page.goto(new URL('/dashboard', base).href);
  await page.getByRole('heading', { name: 'งานบริการของหน่วยงาน', exact: true }).waitFor();
  return { context, page, runtime };
}

async function readProvider(context, providerId) {
  const response = await context.request.get(new URL('/api/providers', base).href);
  requireCheck(response.status() === 200, 'PROVIDER_API_READ_FAILED');
  const body = await response.text();
  requireCheck(!body.includes(fixtureSecret) && !/\bv1\.[A-Za-z0-9+/=_-]{24,}/.test(body), 'PROVIDER_SECRET_VALUE_EXPOSED');
  const payload = JSON.parse(body);
  const provider = payload.providers?.find(item => item.id === providerId);
  requireCheck(provider && Array.isArray(provider.models), 'PROVIDER_API_DTO_MISSING');
  requireCheck(!/(?:api_key_encrypted|ciphertext|"apiKey"\s*:|"api_key"\s*:)/i.test(JSON.stringify(payload)), 'PROVIDER_SECRET_FIELD_EXPOSED');
  return provider;
}

async function submitUiWrite(page, pathname, method, click) {
  const responsePromise = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname === pathname);
  await click();
  const response = await responsePromise;
  requireCheck(response.status() === 200, 'PROVIDER_UI_WRITE_FAILED');
  return response.json();
}

async function runAdminCases() {
  const session = await login(admin);
  const { context, page, runtime } = session;
  try {
    const providerLink = page.getByRole('link', { name: 'จัดการผู้ให้บริการและ Model', exact: true });
    requireCheck(await providerLink.count() === 1 && await providerLink.isVisible(), 'SUPER_ADMIN_PROVIDER_LINK_MISSING');
    requireCheck((await context.request.get(new URL('/providers', base).href)).status() === 200,
      'SUPER_ADMIN_PROVIDER_PAGE_STATUS_INVALID');
    await page.goto(new URL('/providers', base).href);
    requireCheck(await page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).count() === 1,
      'SUPER_ADMIN_PROVIDER_PAGE_MISSING');

    stage = 'create_local_provider';
    const createForm = page.locator('.provider-add-panel form');
    fixtureSecret = `m6-local-only-${randomBytes(24).toString('hex')}`;
    await createForm.getByLabel('ชื่อผู้ให้บริการ').fill(providerName);
    await createForm.getByLabel('API key').fill(fixtureSecret);
    const created = await submitUiWrite(page, '/api/providers', 'POST',
      () => createForm.getByRole('button', { name: 'เพิ่มผู้ให้บริการ', exact: true }).click());
    requireCheck(typeof created.id === 'string' && Number.isInteger(created.revision), 'PROVIDER_CREATE_RESPONSE_INVALID');
    tracked.providers.push(created.id);
    await page.getByRole('heading', { name: providerName, exact: true }).waitFor();
    requireCheck(await page.locator('#new-provider-key').inputValue() === '', 'PROVIDER_KEY_FIELD_NOT_CLEARED');
    requireCheck(!(await page.content()).includes(fixtureSecret), 'PROVIDER_SECRET_RENDERED');

    const providerCard = page.locator('.provider-card').filter({ has: page.getByRole('heading', { name: providerName, exact: true }) });
    stage = 'create_embedding_model';
    await providerCard.locator('.provider-add-model > summary').click();
    const modelForm = providerCard.locator('.provider-add-model .model-form');
    const modelId = `m6_embed_${randomBytes(5).toString('hex')}`;
    const modelName = 'M6 Embedding QA';
    await modelForm.locator('[name="modelId"]').fill(modelId);
    await modelForm.locator('[name="displayName"]').fill(modelName);
    await modelForm.locator('[name="purpose"]').selectOption('EMBEDDING');
    const dimensions = modelForm.locator('[name="embeddingDimensions"]');
    requireCheck(await dimensions.count() === 1 && await dimensions.inputValue() === '', 'EMBEDDING_DIMENSIONS_NOT_BLANK');
    requireCheck(await dimensions.getAttribute('required') !== null, 'EMBEDDING_DIMENSIONS_NOT_REQUIRED');
    for (const capability of ['supportsTools', 'supportsJson', 'supportsVision']) {
      const checkbox = modelForm.locator(`[name="${capability}"]`);
      requireCheck(await checkbox.isDisabled() && !(await checkbox.isChecked()), 'EMBEDDING_CAPABILITY_NOT_CLEARED');
    }
    await dimensions.fill('1536');
    await modelForm.locator('[name="priority"]').fill('5');
    await modelForm.locator('[name="timeoutMs"]').fill('15000');
    const createdModel = await submitUiWrite(page, `/api/providers/${created.id}/models`, 'POST',
      () => modelForm.getByRole('button', { name: 'เพิ่ม Model', exact: true }).click());
    requireCheck(typeof createdModel.id === 'string' && Number.isInteger(createdModel.revision), 'MODEL_CREATE_RESPONSE_INVALID');
    await providerCard.getByRole('heading', { name: modelName, exact: true }).waitFor();
    requireCheck(await providerCard.getByText('Embedding · 1536 มิติ', { exact: true }).count() === 1,
      'EMBEDDING_PURPOSE_NOT_DISPLAYED');
    record('embedding_create_requires_dimensions_and_clears_capabilities');

    stage = 'verify_embedding_dto';
    let provider = await readProvider(context, created.id);
    let model = provider.models.find(item => item.id === createdModel.id);
    requireCheck(model?.purpose === 'EMBEDDING' && model.embeddingDimensions === 1536
      && model.supportsTools === false && model.supportsJson === false && model.supportsVision === false,
    'EMBEDDING_DTO_PERSISTENCE_INVALID');
    record('embedding_configuration_round_trips_in_safe_dto');

    stage = 'switch_embedding_to_generation';
    const modelCard = providerCard.locator('.provider-model').filter({ has: page.getByRole('heading', { name: modelName, exact: true }) });
    await modelCard.locator('.provider-edit-model > summary').click();
    const editForm = modelCard.locator('.provider-edit-model .model-form');
    await editForm.locator('[name="purpose"]').selectOption('GENERATION');
    requireCheck(await editForm.locator('[name="embeddingDimensions"]').count() === 0, 'GENERATION_DIMENSIONS_NOT_CLEARED');
    for (const capability of ['supportsTools', 'supportsJson', 'supportsVision']) {
      requireCheck(!(await editForm.locator(`[name="${capability}"]`).isChecked()), 'GENERATION_SWITCH_DID_NOT_CLEAR_CAPABILITIES');
    }
    await editForm.locator('[name="supportsTools"]').check();
    const updatedGeneration = await submitUiWrite(page, `/api/providers/${created.id}/models/${createdModel.id}`, 'PATCH',
      () => editForm.getByRole('button', { name: 'บันทึก Model', exact: true }).click());
    requireCheck(Number.isInteger(updatedGeneration.revision), 'GENERATION_UPDATE_RESPONSE_INVALID');
    provider = await readProvider(context, created.id);
    model = provider.models.find(item => item.id === createdModel.id);
    requireCheck(model?.purpose === 'GENERATION' && model.embeddingDimensions === null && model.supportsTools,
      'GENERATION_CONFIGURATION_PERSISTENCE_INVALID');

    stage = 'switch_generation_to_embedding';
    await page.reload();
    await page.getByRole('heading', { name: providerName, exact: true }).waitFor();
    const refreshedCard = page.locator('.provider-card').filter({ has: page.getByRole('heading', { name: providerName, exact: true }) });
    const refreshedModelCard = refreshedCard.locator('.provider-model').filter({ has: page.getByRole('heading', { name: modelName, exact: true }) });
    await refreshedModelCard.locator('.provider-edit-model > summary').click();
    const refreshedEdit = refreshedModelCard.locator('.provider-edit-model .model-form');
    requireCheck(await refreshedEdit.locator('[name="supportsTools"]').isChecked(), 'GENERATION_EDIT_CAPABILITY_NOT_PRESERVED');
    await refreshedEdit.locator('[name="purpose"]').selectOption('EMBEDDING');
    const refreshedDimensions = refreshedEdit.locator('[name="embeddingDimensions"]');
    requireCheck(await refreshedDimensions.inputValue() === '', 'SWITCH_TO_EMBEDDING_REUSED_DIMENSIONS');
    for (const capability of ['supportsTools', 'supportsJson', 'supportsVision']) {
      const checkbox = refreshedEdit.locator(`[name="${capability}"]`);
      requireCheck(await checkbox.isDisabled() && !(await checkbox.isChecked()), 'SWITCH_TO_EMBEDDING_DID_NOT_CLEAR_CAPABILITIES');
    }
    await refreshedDimensions.fill('768');
    const updatedEmbedding = await submitUiWrite(page, `/api/providers/${created.id}/models/${createdModel.id}`, 'PATCH',
      () => refreshedEdit.getByRole('button', { name: 'บันทึก Model', exact: true }).click());
    requireCheck(Number.isInteger(updatedEmbedding.revision), 'EMBEDDING_UPDATE_RESPONSE_INVALID');
    provider = await readProvider(context, created.id);
    model = provider.models.find(item => item.id === createdModel.id);
    requireCheck(model?.purpose === 'EMBEDDING' && model.embeddingDimensions === 768
      && !model.supportsTools && !model.supportsJson && !model.supportsVision, 'EMBEDDING_UPDATE_PERSISTENCE_INVALID');
    requireCheck(runtime.pageError === false, 'PROVIDER_EMBEDDING_PAGE_RUNTIME_ERROR');
    record('purpose_switches_clear_incompatible_fields_and_save');

    stage = 'logout_admin';
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/login');
    requireCheck((await context.request.get(new URL('/api/providers', base).href)).status() === 401,
      'LOGGED_OUT_PROVIDER_API_NOT_DENIED');
    requireCheck(runtime.pageError === false, 'PROVIDER_LOGOUT_RUNTIME_ERROR');
  } finally {
    await context.close();
  }
}

async function runStaffDenied(account) {
  stage = 'staff_login';
  const { context, page, runtime } = await login(account);
  try {
    requireCheck(await page.getByRole('link', { name: 'จัดการผู้ให้บริการและ Model', exact: true }).count() === 0,
      'ORDINARY_STAFF_PROVIDER_LINK_VISIBLE');
    requireCheck((await context.request.get(new URL('/api/providers', base).href)).status() === 403,
      'ORDINARY_STAFF_PROVIDER_API_NOT_DENIED');
    await page.goto(new URL('/providers', base).href);
    await page.getByRole('heading', { name: '404', exact: true }).waitFor();
    requireCheck(await page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).count() === 0,
      'ORDINARY_STAFF_PROVIDER_PAGE_NOT_HIDDEN');
    requireCheck(runtime.pageError === false, 'STAFF_PROVIDER_PAGE_RUNTIME_ERROR');
    await page.reload();
    await page.getByRole('heading', { name: '404', exact: true }).waitFor();
    requireCheck(runtime.pageError === false, 'STAFF_PROVIDER_RELOAD_RUNTIME_ERROR');
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/login');
    requireCheck((await context.request.get(new URL('/api/providers', base).href)).status() === 401,
      'LOGGED_OUT_PROVIDER_API_NOT_DENIED');
    requireCheck(runtime.pageError === false, 'STAFF_PROVIDER_LOGOUT_RUNTIME_ERROR');
    record('ordinary_staff_provider_access_denied_and_logout');
  } finally {
    await context.close();
  }
}

try {
  requireCheck(['localhost', '127.0.0.1'].includes(base.hostname) && base.protocol === 'http:' && base.port === '3001'
    && !base.username && !base.password && base.pathname === '/', 'LOCAL_PRODUCTION_SERVER_REQUIRED');
  requireCheck(typeof process.env.DEV_SUPABASE_PROJECT_REF === 'string', 'DEVELOPMENT_PROJECT_REF_MISSING');
  const credentials = JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json', 'utf8'));
  requireCheck(credentials.projectRef === process.env.DEV_SUPABASE_PROJECT_REF, 'DEVELOPMENT_PROJECT_MISMATCH');
  requireCheck(Array.isArray(credentials.accounts) && credentials.accounts.length === 3, 'DEVELOPMENT_ACCOUNT_SET_INVALID');
  admin = credentials.accounts.find(account => account.role === 'SUPER_ADMIN');
  itAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'IT');
  libraryAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'LIBRARY');
  accounts = [admin, itAccount, libraryAccount];
  requireCheck(accounts.every(account => account && typeof account.id === 'string' && typeof account.email === 'string'
    && typeof account.password === 'string' && typeof account.displayName === 'string'), 'DEVELOPMENT_ACCOUNT_FIELDS_INVALID');
  providerName = `M6 QA ${randomBytes(6).toString('hex')} embedding fixture`;

  pg = new Client({ connectionString: localDatabaseUrl });
  await pg.connect();
  stage = 'trusted_auth_mirrors';
  await createLocalProfiles();
  browser = await chromium.launch({ headless: true });
  await runAdminCases();
  stage = 'staff_access';
  await runStaffDenied(itAccount);
  await runStaffDenied(libraryAccount);
  console.log(JSON.stringify({ stage: 'provider_embedding_browser_cases', cases }));
} catch (error) {
  const check = typeof error?.message === 'string' && /^[A-Z_0-9]{1,100}$/.test(error.message) ? error.message : 'RUNNER_ERROR';
  console.error(JSON.stringify({ code: 'PROVIDER_EMBEDDING_BROWSER_FAILED', stage, check }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => { process.exitCode = 1; });
  stage = 'fixture_cleanup';
  try {
    await cleanupFixtures();
  } catch {
    console.error(JSON.stringify({ code: 'PROVIDER_EMBEDDING_FIXTURE_CLEANUP_FAILED', stage }));
    process.exitCode = 1;
  }
  if (pg) await pg.end().catch(() => { process.exitCode = 1; });
}
