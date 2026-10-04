import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const tracked = {
  departments: [], authUsers: [], profiles: [], sessions: [], conversations: [], tickets: [],
  identities: [], messages: [], history: [], activities: [], outbox: [], receipts: [], choices: [], staffTokens: [],
};
let pg;
let browser;
let stage = 'target_preflight';

function requireCheck(condition, code) {
  if (!condition) throw new Error(code);
}

function record(name) {
  cases.push({ name, passed: true });
}

function userMarker(value) {
  return typeof value === 'string' && value.startsWith(prefix);
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

const prefix = `M4 QA ${randomBytes(4).toString('hex')}`;
const summaries = {
  it: `${prefix} IT general request`,
  library: `${prefix} Library general request`,
  restricted: `${prefix} IT restricted request`,
};
const replyText = `${prefix} staff reply`;
const departmentIds = new Map();
const ticketIds = new Map();
const sessionIds = new Map();
const conversationIds = new Map();
const profileIds = new Map();
const ownedDepartments = new Set();

async function ensureDepartment(code, nameTh, nameEn) {
  const current = (await pg.query('select id,active from public.departments where code=$1', [code])).rows[0];
  if (current) {
    requireCheck(current.active === true, 'FIXTURE_DEPARTMENT_INACTIVE');
    departmentIds.set(code, current.id);
    return;
  }
  const inserted = (await pg.query(
    'insert into public.departments(code,name_th,name_en,active) values($1,$2,$3,true) returning id',
    [code, nameTh, nameEn],
  )).rows[0];
  departmentIds.set(code, inserted.id);
  ownedDepartments.add(inserted.id);
  tracked.departments.push(inserted.id);
}

async function createLocalProfiles() {
  for (const account of accounts) {
    const existing = (await pg.query(
      'select exists(select 1 from auth.users where id=$1) or exists(select 1 from public.staff_profiles where id=$1) as exists',
      [account.id],
    )).rows[0].exists;
    requireCheck(existing === false, 'LOCAL_AUTH_PROFILE_ALREADY_EXISTS');
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
}

async function createTicketFixture(kind, departmentCode, sensitivity, summary) {
  const session = (await pg.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`${prefix} ${kind} session`],
  )).rows[0].id;
  tracked.sessions.push(session);
  sessionIds.set(kind, session);
  const conversation = (await pg.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status,topic)
     values($1,'TICKET','HUMAN','ACTIVE',$2) returning id`,
    [session, summary],
  )).rows[0].id;
  tracked.conversations.push(conversation);
  conversationIds.set(kind, conversation);
  const ticket = (await pg.query(
    `insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level)
     values($1,$2,$3,$4,'HUMAN','WAITING_STAFF',$5) returning id`,
    [session, conversation, departmentIds.get(departmentCode), summary, sensitivity],
  )).rows[0].id;
  tracked.tickets.push(ticket);
  ticketIds.set(kind, ticket);
  await pg.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversation, ticket]);
}

async function setupFixtures() {
  await pg.query('begin');
  try {
    await ensureDepartment('IT', 'ฝ่ายเทคโนโลยีสารสนเทศ', 'Information Technology');
    await ensureDepartment('LIBRARY', 'ห้องสมุด', 'Library');
    await createLocalProfiles();
    await createTicketFixture('it', 'IT', 'GENERAL', summaries.it);
    await createTicketFixture('library', 'LIBRARY', 'GENERAL', summaries.library);
    await createTicketFixture('restricted', 'IT', 'RESTRICTED', summaries.restricted);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function cleanupFixtures() {
  if (!pg) return;
  const ticketIdsParam = tracked.tickets;
  const sessionIdsParam = tracked.sessions;
  const conversationIdsParam = tracked.conversations;
  const messageRows = (await pg.query('select id from public.messages where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.messages.push(...messageRows.map(row => row.id));
  const historyRows = (await pg.query('select id from public.ticket_history where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.history.push(...historyRows.map(row => row.id));
  const activityRows = (await pg.query('select id from private.activities where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.activities.push(...activityRows.map(row => row.id));
  const outboxRows = (await pg.query('select id from private.message_outbox where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.outbox.push(...outboxRows.map(row => row.id));
  const receiptRows = (await pg.query('select ticket_id,request_id from private.ticket_action_receipts where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.receipts.push(...receiptRows.map(row => ({ ticketId: row.ticket_id, requestId: row.request_id })));
  const choiceRows = (await pg.query('select token_hash from private.pending_route_choices where line_session_id=any($1::uuid[])', [sessionIdsParam])).rows;
  tracked.choices.push(...choiceRows.map(row => row.token_hash));
  const tokenRows = (await pg.query('select token_hash from private.staff_action_tokens where ticket_id=any($1::uuid[])', [ticketIdsParam])).rows;
  tracked.staffTokens.push(...tokenRows.map(row => row.token_hash));

  await pg.query('begin');
  try {
    await pg.query('delete from private.delivery_attempts where outbox_id=any($1::uuid[])', [tracked.outbox]);
    await pg.query('delete from private.message_outbox where id=any($1::uuid[])', [tracked.outbox]);
    await pg.query('delete from private.ticket_action_receipts where ticket_id=any($1::uuid[])', [ticketIdsParam]);
    await pg.query('delete from private.staff_action_tokens where ticket_id=any($1::uuid[])', [ticketIdsParam]);
    await pg.query('delete from private.pending_route_choices where line_session_id=any($1::uuid[])', [sessionIdsParam]);
    await pg.query('delete from private.activities where ticket_id=any($1::uuid[])', [ticketIdsParam]);
    await pg.query('delete from public.ticket_history where id=any($1::uuid[])', [tracked.history]);
    await pg.query('delete from public.messages where id=any($1::uuid[])', [tracked.messages]);
    await pg.query('update public.conversations set active_ticket_id=null where id=any($1::uuid[])', [conversationIdsParam]);
    await pg.query('delete from public.tickets where id=any($1::uuid[])', [ticketIdsParam]);
    await pg.query('delete from public.conversations where id=any($1::uuid[])', [conversationIdsParam]);
    await pg.query('delete from private.line_identities where line_session_id=any($1::uuid[])', [sessionIdsParam]);
    await pg.query('delete from public.line_sessions where id=any($1::uuid[])', [sessionIdsParam]);
    await pg.query('delete from public.staff_profiles where id=any($1::uuid[])', [tracked.profiles]);
    await pg.query('delete from auth.users where id=any($1::uuid[])', [tracked.authUsers]);
    await pg.query('delete from public.departments where id=any($1::uuid[])', [tracked.departments]);
    await pg.query('commit');
  } catch {
    await pg.query('rollback').catch(() => undefined);
    throw new Error('FIXTURE_CLEANUP_FAILED');
  }
}

async function login(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto(new URL('/tickets', browserTarget).href);
  await page.waitForURL(url => url.pathname === '/login');
  await page.getByLabel('อีเมลบุคลากร').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/dashboard' || url.pathname === '/tickets', { timeout: 30_000 });
  const roleLine = await page.locator('.user-line').innerText();
  requireCheck(roleLine.includes(roleLabels[account.role]), 'SERVER_ROLE_NOT_RENDERED');
  await page.goto(new URL('/tickets', browserTarget).href);
  await page.getByRole('heading', { name: 'งานรับเรื่อง', exact: true }).waitFor();
  return { context, page };
}

async function readList(context) {
  const response = await context.request.get(new URL('/api/tickets', browserTarget).href);
  requireCheck(response.status() === 200, 'TICKET_LIST_API_FAILED');
  const result = await response.json();
  requireCheck(Array.isArray(result.tickets), 'TICKET_LIST_SHAPE_INVALID');
  return result.tickets;
}

async function waitForSaved(page) {
  await page.locator('.ticket-action-notice-success').waitFor({ state: 'visible', timeout: 15_000 });
}

async function waitForBadge(page, text) {
  await page.waitForFunction(expected => document.querySelector('.ticket-detail-badges .ticket-status')?.textContent?.trim() === expected, text);
}

async function openFixture(page, ticketId, summary) {
  await page.getByRole('link', { name: summary, exact: true }).click();
  await page.getByRole('heading', { name: summary, exact: true }).waitFor();
  requireCheck(page.url().includes(`/tickets/${ticketId}`), 'TICKET_DETAIL_NAVIGATION_FAILED');
}

async function runBrowserCases() {
  stage = 'unauthenticated_api';
  const anonymous = await browser.newContext();
  const anonymousResponse = await anonymous.request.get(new URL('/api/tickets', browserTarget).href);
  requireCheck(anonymousResponse.status() === 401, 'UNAUTHENTICATED_API_NOT_DENIED');
  record('unauthenticated_ticket_api_401');
  const anonymousPage = await anonymous.newPage();
  const unauthPageResponse = await anonymousPage.goto(new URL('/tickets', browserTarget).href);
  await anonymousPage.waitForURL(url => url.pathname === '/login');
  requireCheck(unauthPageResponse?.status() === 200, 'UNAUTHENTICATED_TICKET_PAGE_DID_NOT_REDIRECT');
  await anonymous.close();
  record('unauthenticated_ticket_page_login_redirect');

  stage = 'super_admin_login';
  const superSession = await login(admin);
  const superTickets = await readList(superSession.context);
  const superMarkerCount = superTickets.filter(ticket => userMarker(ticket.problem_summary)).length;
  requireCheck(superMarkerCount === 3 && Object.values(summaries).every(summary => superTickets.some(ticket => ticket.problem_summary === summary)), 'SUPER_ADMIN_SCOPE_LIST_INVALID');
  requireCheck(await superSession.page.getByRole('link', { name: summaries.it, exact: true }).count() === 1, 'SUPER_ADMIN_LIST_UI_MISSING_TICKET');
  record('super_admin_scoped_list_three_fixtures');

  stage = 'super_admin_detail';
  const superRestricted = await superSession.context.request.get(new URL(`/api/tickets/${ticketIds.get('restricted')}`, browserTarget).href);
  requireCheck(superRestricted.status() === 200, 'SUPER_ADMIN_RESTRICTED_DETAIL_DENIED');
  record('super_admin_restricted_detail_allowed');
  await superSession.context.close();

  stage = 'it_login_and_scope';
  const itSession = await login(itAccount);
  const itTickets = await readList(itSession.context);
  const itMarkers = itTickets.filter(ticket => userMarker(ticket.problem_summary));
  requireCheck(itMarkers.length === 1 && itMarkers[0].problem_summary === summaries.it, 'IT_SCOPE_LIST_INVALID');
  requireCheck(await itSession.page.getByRole('link', { name: summaries.it, exact: true }).count() === 1, 'IT_LIST_UI_MISSING_OWN_TICKET');
  requireCheck(await itSession.page.getByText(summaries.library, { exact: true }).count() === 0, 'IT_UI_LEAKED_FOREIGN_TICKET');
  requireCheck(await itSession.page.getByText(summaries.restricted, { exact: true }).count() === 0, 'IT_UI_LEAKED_RESTRICTED_TICKET');
  record('it_list_and_ui_show_only_general_department_ticket');

  stage = 'it_foreign_detail_denied';
  for (const kind of ['library', 'restricted']) {
    const direct = await itSession.context.request.get(new URL(`/api/tickets/${ticketIds.get(kind)}`, browserTarget).href);
    requireCheck(direct.status() === 404, 'IT_FOREIGN_OR_RESTRICTED_API_NOT_HIDDEN');
    const pageResponse = await itSession.page.goto(new URL(`/tickets/${ticketIds.get(kind)}`, browserTarget).href);
    // Next streaming loading boundaries commit 200 before notFound; the API remains strictly 404.
    requireCheck([200,404].includes(pageResponse?.status()), 'IT_FOREIGN_OR_RESTRICTED_UI_INVALID_STATUS');
    await itSession.page.getByRole('heading',{name:'ไม่พบเรื่องที่เข้าถึงได้',exact:true}).waitFor();
    requireCheck(await itSession.page.locator('.ticket-detail-header,.ticket-action-panel').count()===0,'IT_FOREIGN_OR_RESTRICTED_UI_NOT_HIDDEN');
    requireCheck(await itSession.page.getByText(summaries[kind], { exact: true }).count() === 0, 'IT_FOREIGN_OR_RESTRICTED_SUMMARY_RENDERED');
  }
  record('it_foreign_restricted_api_404_and_ui_not_found_without_details');

  stage = 'it_accept_ticket';
  await itSession.page.goto(new URL('/tickets', browserTarget).href);
  await openFixture(itSession.page, ticketIds.get('it'), summaries.it);
  const acceptResponsePromise=itSession.page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/accept'));
  await itSession.page.getByRole('button', { name: 'รับเรื่องนี้', exact: true }).click();
  const acceptResponse=await acceptResponsePromise;
  requireCheck(acceptResponse.status()===200,`UI_ACCEPT_HTTP_${acceptResponse.status()}`);
  await waitForSaved(itSession.page);
  await waitForBadge(itSession.page, 'เจ้าหน้าที่กำลังดูแล');
  await itSession.page.screenshot({path:resolve('.superpowers/staging/m4-ticket-desktop.png'),fullPage:true});
  record('it_accept_action_updates_human_ticket');

  stage = 'it_reply_ticket';
  const replyRequestPromise = itSession.page.waitForRequest(request => request.method() === 'POST'
    && new URL(request.url()).pathname.endsWith('/reply'));
  await itSession.page.getByLabel('ข้อความตอบกลับ').fill(replyText);
  await itSession.page.getByRole('button', { name: 'ส่งคำตอบ', exact: true }).click();
  const replyRequest = await replyRequestPromise;
  const replyBody = JSON.parse(replyRequest.postData() ?? 'null');
  requireCheck(replyBody && typeof replyBody.requestId === 'string' && replyBody.text === replyText, 'UI_REPLY_REQUEST_CAPTURE_INVALID');
  await waitForSaved(itSession.page);
  await waitForBadge(itSession.page, 'รอผู้แจ้ง');
  record('it_reply_action_moves_ticket_to_waiting_user');

  stage = 'reply_idempotency_replay';
  const replyUrl = new URL(`/api/tickets/${ticketIds.get('it')}/reply`, browserTarget).href;
  const firstReplay = await itSession.context.request.post(replyUrl, { data: replyBody, headers: { origin: browserTarget.origin } });
  const secondReplay = await itSession.context.request.post(replyUrl, { data: replyBody, headers: { origin: browserTarget.origin } });
  const firstResult = await firstReplay.json();
  const secondResult = await secondReplay.json();
  requireCheck(firstReplay.status() === 200 && secondReplay.status() === 200
    && JSON.stringify(firstResult) === JSON.stringify(secondResult), 'REPLY_IDEMPOTENCY_REPLAY_FAILED');
  const replyDbState = (await pg.query(
    `select t.status,t.revision,
      (select count(*)::int from public.messages m where m.ticket_id=t.id and m.sender_type='STAFF' and m.sender_staff_id=$2 and m.content=$3) as reply_count,
      (select count(*)::int from public.ticket_history h where h.ticket_id=t.id and h.action='STAFF_REPLIED') as history_count,
      (select count(*)::int from private.message_outbox o where o.ticket_id=t.id and o.kind='STAFF') as outbox_count,
      (select count(*)::int from private.ticket_action_receipts r where r.ticket_id=t.id and r.staff_id=$2 and r.action='STAFF_REPLY' and r.request_id=$4) as receipt_count
     from public.tickets t where t.id=$1`,
    [ticketIds.get('it'), itAccount.id, replyText, replyBody.requestId],
  )).rows[0];
  requireCheck(replyDbState.status === 'WAITING_USER' && replyDbState.revision === 2
    && replyDbState.reply_count === 1 && replyDbState.history_count === 1
    && replyDbState.outbox_count === 1 && replyDbState.receipt_count === 1, 'REPLY_REPLAY_CREATED_DUPLICATE_EFFECTS');
  record('same_reply_request_replayed_once');

  stage = 'stale_revision_conflict';
  const stale = await itSession.context.request.post(replyUrl, {
    data: { revision: 0, requestId: randomUUID(), text: `${prefix} stale request` },
    headers: { origin: browserTarget.origin },
  });
  requireCheck(stale.status() === 409, 'STALE_REVISION_NOT_CONFLICT');
  record('stale_revision_returns_409');

  stage = 'cross_origin_write_denial';
  const crossOrigin = await itSession.context.request.post(new URL(`/api/tickets/${ticketIds.get('it')}/reply`, browserTarget).href, {
    data: { revision: 2, requestId: randomUUID(), text: `${prefix} cross-origin request` },
    headers: { origin: 'https://untrusted.invalid' },
  });
  requireCheck(crossOrigin.status() === 403, 'CROSS_ORIGIN_WRITE_NOT_DENIED');
  const guardedState = (await pg.query(
    `select t.status,
      (select count(*)::int from public.messages m where m.ticket_id=t.id and m.sender_type='STAFF' and m.sender_staff_id=$2) as reply_count,
      (select count(*)::int from public.ticket_history h where h.ticket_id=t.id and h.action='STAFF_REPLIED') as history_count
     from public.tickets t where t.id=$1`,
    [ticketIds.get('it'), itAccount.id],
  )).rows[0];
  requireCheck(guardedState.status === 'WAITING_USER' && guardedState.reply_count === 1 && guardedState.history_count === 1,
    'GUARDED_REQUEST_CHANGED_TICKET');
  record('cross_origin_write_returns_403');
  await itSession.context.close();

  stage = 'library_login_and_scope';
  const librarySession = await login(libraryAccount);
  const libraryTickets = await readList(librarySession.context);
  const libraryMarkers = libraryTickets.filter(ticket => userMarker(ticket.problem_summary));
  requireCheck(libraryMarkers.length === 1 && libraryMarkers[0].problem_summary === summaries.library, 'LIBRARY_SCOPE_LIST_INVALID');
  record('library_scoped_list_one_fixture');

  stage = 'library_resolve_close';
  await openFixture(librarySession.page, ticketIds.get('library'), summaries.library);
  await librarySession.page.getByRole('button', { name: 'รับเรื่องนี้', exact: true }).click();
  await waitForSaved(librarySession.page);
  await waitForBadge(librarySession.page, 'เจ้าหน้าที่กำลังดูแล');
  await librarySession.page.getByRole('button', { name: 'ทำเครื่องหมายว่าแก้ไขแล้ว', exact: true }).click();
  await waitForSaved(librarySession.page);
  await waitForBadge(librarySession.page, 'แก้ไขแล้ว');
  await librarySession.page.getByRole('button', { name: 'ปิดเรื่อง', exact: true }).click();
  await waitForSaved(librarySession.page);
  await waitForBadge(librarySession.page, 'ปิดงาน');
  record('library_accept_resolve_close_lifecycle');

  stage = 'mobile_overflow';
  await librarySession.page.setViewportSize({ width: 390, height: 844 });
  await librarySession.page.goto(new URL('/tickets', browserTarget).href);
  await librarySession.page.getByRole('heading', { name: 'งานรับเรื่อง', exact: true }).waitFor();
  const listWidth = await librarySession.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  requireCheck(listWidth.scroll <= listWidth.client + 1, 'MOBILE_LIST_OVERFLOW');
  await librarySession.page.goto(new URL(`/tickets/${ticketIds.get('library')}`, browserTarget).href);
  await librarySession.page.getByRole('heading', { name: summaries.library, exact: true }).waitFor();
  const detailWidth = await librarySession.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  requireCheck(detailWidth.scroll <= detailWidth.client + 1, 'MOBILE_DETAIL_OVERFLOW');
  await librarySession.page.screenshot({path:resolve('.superpowers/staging/m4-ticket-mobile.png'),fullPage:true});
  record('mobile_390px_list_and_detail_no_horizontal_overflow');
  await librarySession.context.close();
}

try {
  pg = new Client({ connectionString: localDatabaseUrl });
  await pg.connect();
  stage = 'fixture_setup';
  await setupFixtures();
  stage = 'browser_start';
  browser = await chromium.launch({ headless: true });
  await runBrowserCases();
  console.log(JSON.stringify({ stage: 'ticket_browser_cases', cases }));
} catch (error) {
  console.error(JSON.stringify({ code: 'TICKET_BROWSER_RUN_FAILED', stage, errorType: error?.name ?? 'Error',
   check:typeof error?.message==='string'&&/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'RUNNER_ERROR' }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => { process.exitCode = 1; });
  stage = 'fixture_cleanup';
  try {
    await cleanupFixtures();
  } catch {
    console.error(JSON.stringify({ code: 'TICKET_FIXTURE_CLEANUP_FAILED', stage }));
    process.exitCode = 1;
  }
  if (pg) await pg.end().catch(() => { process.exitCode = 1; });
}
