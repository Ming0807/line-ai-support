import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse as parseEnv } from 'dotenv';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH
  ? resolve(process.env.PLAYWRIGHT_RUNTIME_PATH, 'package.json')
  : import.meta.url);
const { chromium } = require('playwright');

const base = new URL('http://localhost:3000');
const expectedProviders = new Set([
  'id', 'name', 'adapter', 'baseUrl', 'enabled', 'priority', 'healthStatus',
  'lastHealthCheck', 'keyConfigured', 'revision', 'models',
]);
const expectedModels = new Set([
  'id', 'modelId', 'displayName', 'supportsTools', 'supportsJson', 'supportsVision',
  'enabled', 'priority', 'timeoutMs', 'inputPricePerMillion', 'outputPricePerMillion', 'revision',
]);
const roleLabels = { SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด', STAFF: 'บุคลากร' };
const results = [];
let stage = 'environment_preflight';
let browser;
let accounts = [];

function requireCheck(condition, code) {
  if (!condition) throw new Error(code);
}

function validateProviderDto(provider) {
  requireCheck(provider && typeof provider === 'object' && !Array.isArray(provider), 'PROVIDER_DTO_INVALID');
  requireCheck(Object.keys(provider).length === expectedProviders.size
    && Object.keys(provider).every(key => expectedProviders.has(key)), 'PROVIDER_DTO_UNSAFE_FIELDS');
  requireCheck(Array.isArray(provider.models), 'PROVIDER_MODEL_LIST_INVALID');
  for (const model of provider.models) {
    requireCheck(model && typeof model === 'object' && !Array.isArray(model), 'MODEL_DTO_INVALID');
    requireCheck(Object.keys(model).length === expectedModels.size
      && Object.keys(model).every(key => expectedModels.has(key)), 'MODEL_DTO_UNSAFE_FIELDS');
  }
}

function validateNoSecretValues(value) {
  const serialized = JSON.stringify(value);
  requireCheck(!/(?:api_key_encrypted|ciphertext|"apiKey"\s*:|"api_key"\s*:)/i.test(serialized), 'PROVIDER_SECRET_FIELD_EXPOSED');
  requireCheck(!/\bv1\.[A-Za-z0-9+/=_-]{24,}/.test(serialized)
    && !/\bsk-[A-Za-z0-9_-]{8,}/.test(serialized), 'PROVIDER_SECRET_VALUE_EXPOSED');
}

async function checkProviderAccess(page, account) {
  stage = 'dashboard_role_link';
  const roleLine = await page.locator('.user-line').innerText();
  requireCheck(roleLine.includes(roleLabels[account.role]), 'SERVER_ROLE_NOT_RENDERED');
  const providerLink = page.getByRole('link', { name: 'จัดการผู้ให้บริการและ Model', exact: true });
  if (account.role === 'SUPER_ADMIN') {
    requireCheck(await providerLink.count() === 1 && await providerLink.isVisible(), 'SUPER_ADMIN_PROVIDER_LINK_MISSING');

    stage = 'provider_page';
    const pageResponse = await page.goto(new URL('/providers', base).href);
    requireCheck(pageResponse?.status() === 200, 'SUPER_ADMIN_PROVIDER_PAGE_STATUS_INVALID');
    await page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).waitFor();

    stage = 'provider_safe_api';
    const response = await page.request.get(new URL('/api/providers', base).href);
    requireCheck(response.status() === 200, 'SUPER_ADMIN_PROVIDER_API_STATUS_INVALID');
    const payload = await response.json();
    requireCheck(payload && Array.isArray(payload.providers), 'PROVIDER_API_SHAPE_INVALID');
    for (const provider of payload.providers) validateProviderDto(provider);
    validateNoSecretValues(payload);
    requireCheck(await page.locator('.provider-card').count() === payload.providers.length, 'PROVIDER_PAGE_API_COUNT_MISMATCH');
    const pageHtml = await page.content();
    requireCheck(!/(?:api_key_encrypted|ciphertext|"apiKey"\s*:|"api_key"\s*:)/i.test(pageHtml)
      && !/\bv1\.[A-Za-z0-9+/=_-]{24,}/.test(pageHtml)
      && !/\bsk-[A-Za-z0-9_-]{8,}/.test(pageHtml), 'PROVIDER_PAGE_SECRET_EXPOSED');

    return { providerCount: payload.providers.length, modelCount: payload.providers.reduce((sum, item) => sum + item.models.length, 0) };
  }

  requireCheck(await providerLink.count() === 0, 'ORDINARY_STAFF_PROVIDER_LINK_VISIBLE');
  stage = 'staff_provider_api';
  const response = await page.request.get(new URL('/api/providers', base).href);
  requireCheck(response.status() === 403, 'ORDINARY_STAFF_PROVIDER_API_NOT_DENIED');

  stage = 'staff_provider_page';
  await page.goto(new URL('/providers', base).href);
  await page.getByRole('heading', { name: '404', exact: true }).waitFor();
  requireCheck(await page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).count() === 0,
    'ORDINARY_STAFF_PROVIDER_PAGE_NOT_HIDDEN');
  return { providerCount: null, modelCount: null };
}

try {
  stage = 'environment_preflight';
  const developmentEnv = parseEnv(await readFile('.env', 'utf8'));
  const credentials = JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json', 'utf8'));
  requireCheck(base.hostname === 'localhost' && base.protocol === 'http:' && base.port === '3000'
    && base.pathname === '/', 'DEVELOPMENT_BROWSER_TARGET_INVALID');
  requireCheck(developmentEnv.YRU_DEPLOYMENT_ENV === 'development'
    && process.env.YRU_DEPLOYMENT_ENV === 'development', 'DEVELOPMENT_ENVIRONMENT_REQUIRED');
  requireCheck(typeof credentials.projectRef === 'string'
    && credentials.projectRef === developmentEnv.DEV_SUPABASE_PROJECT_REF
    && credentials.projectRef === process.env.DEV_SUPABASE_PROJECT_REF, 'DEVELOPMENT_PROJECT_MISMATCH');
  requireCheck(Array.isArray(credentials.accounts) && credentials.accounts.length === 3, 'DEVELOPMENT_ACCOUNT_SET_INVALID');
  const admin = credentials.accounts.find(account => account.role === 'SUPER_ADMIN');
  const itAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'IT');
  const libraryAccount = credentials.accounts.find(account => account.role === 'STAFF' && account.departmentCode === 'LIBRARY');
  accounts = [admin, itAccount, libraryAccount];
  requireCheck(accounts.every(account => account && typeof account.email === 'string'
    && typeof account.password === 'string' && typeof account.displayName === 'string'), 'DEVELOPMENT_ACCOUNT_FIELDS_INVALID');

  stage = 'browser_start';
  browser = await chromium.launch({ headless: true });
  for (const account of accounts) {
    stage = 'login';
    const context = await browser.newContext();
    const page = await context.newPage();
    let pageError = false;
    page.on('pageerror', () => { pageError = true; });
    try {
      await page.goto(new URL('/login', base).href);
      await page.getByLabel('อีเมลบุคลากร').fill(account.email);
      await page.getByLabel('รหัสผ่าน').fill(account.password);
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
      await page.waitForURL(/\/(?:dashboard|tickets)$/, { timeout: 30_000 });
      stage = 'dashboard';
      await page.goto(new URL('/dashboard', base).href);
      await page.getByRole('heading', { name: 'งานบริการของหน่วยงาน', exact: true }).waitFor();

      const access = await checkProviderAccess(page, account);
      requireCheck(pageError === false, 'PROVIDER_PAGE_RUNTIME_ERROR');

      stage = 'reload';
      await page.reload();
      if (account.role === 'SUPER_ADMIN') {
        await page.getByRole('heading', { name: 'ผู้ให้บริการ AI', exact: true }).waitFor();
      } else {
        await page.getByRole('heading', { name: '404', exact: true }).waitFor();
      }
      requireCheck(pageError === false, 'PROVIDER_RELOAD_RUNTIME_ERROR');

      stage = 'logout';
      await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/login');
      const loggedOutResponse = await context.request.get(new URL('/api/providers', base).href);
      requireCheck(loggedOutResponse.status() === 401, 'LOGGED_OUT_PROVIDER_API_NOT_DENIED');
      requireCheck(pageError === false, 'PROVIDER_LOGOUT_RUNTIME_ERROR');

      results.push({
        role: account.role,
        department: account.departmentCode ?? null,
        dashboard: true,
        providerAccess: account.role === 'SUPER_ADMIN' ? 'allowed' : 'hidden',
        providerCount: access.providerCount,
        modelCount: access.modelCount,
        reload: true,
        logoutApi401: true,
      });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ stage: 'development_provider_browser_verified', accounts: results }));
} catch (error) {
  const code = typeof error?.message === 'string' && /^[A-Z_0-9]{1,100}$/.test(error.message) ? error.message : 'RUNNER_ERROR';
  console.error(JSON.stringify({ code: 'DEVELOPMENT_PROVIDER_BROWSER_FAILED', stage, check: code }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
