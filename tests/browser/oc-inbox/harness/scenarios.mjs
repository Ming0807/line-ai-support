/**
 * OC-INBOX-05 mounted scenarios (fixture browser, RED-first).
 *
 * Every scenario drives the REAL production components through the fixture
 * (compiled from the worktree sources by server.mjs) with synthetic
 * same-contract adapters. Scenarios assert the DESIRED behavior; running them
 * against a commit whose sources still carry a defect fails with captured
 * evidence (network log/console snapshots). No assertion inspects source text.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BASE = 'http://127.0.0.1';

/** Artifacts can be re-pointed by the runner; default: this harness's artifacts dir. */
export const ARTIFACTS_DIR = process.env.OC_INBOX_ARTIFACTS_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifacts');

const uuidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const uuidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb2';
const uuidD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

function json(value) { return JSON.stringify(value); }

function ticketItem(id, suffix, summary, revision, status, mode) {
  return {
    id,
    ticket_no: `T-2026-00${suffix}`,
    department_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc0',
    department_name: 'งานทะเบียน (fixture)',
    category: 'REG_ALL',
    problem_summary: summary,
    priority: 'HIGH',
    status,
    mode,
    sensitive_level: 'GENERAL',
    assigned_staff_id: uuidA === id ? 'staff-fixture-a' : null,
    assignee_name: uuidA === id ? 'เจ้าหน้าที่ Fixtures' : null,
    revision,
    created_at: '2026-10-28T01:00:00.000Z',
    updated_at: '2026-10-28T02:00:00.000Z',
    anonymous_code: `F1X${suffix}R3`,
  };
}

function threadFor(item, options = {}) {
  const {revision = item.revision, perms, messages = 3, seqFrom = 1, sequences = null, hasMore = false, nextBefore = null, delivery = null} = options;
  const permissions = perms ?? {accept: true, reply: true, resolve: true, close: true, reassign: true, reopen: true};
  // Message ids encode the sequence so overlapping windows carry DISTINCT ids
  // (mergeThreadWindow dedupes by id; identical ids would hide the stale-merge defect).
  const seqList = Array.isArray(sequences) && sequences.length > 0
    ? sequences
    : Array.from({length: messages}, (_, index) => seqFrom + index);
  const firstSeq = seqList[0] ?? 1;
  const lastSeq = seqList[seqList.length - 1] ?? 0;
  const list = seqList.map((seq, index) => ({
    id: `m-${seq}`,
    sequence: seq,
    senderType: index % 2 === 0 ? 'USER' : 'STAFF',
    staffName: index % 2 === 0 ? null : 'เจ้าหน้าที่ Fixtures',
    content: `ข้อความสังเคราะห์ ${index + 1}`,
    createdAt: `2026-10-28T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
    deliveryStatus: index === 1 ? (delivery ?? 'SENT') : null,
    attachments: [],
  }));
  return {
    detail: {
      ticket: {...item, revision},
      messages: [],
      history: [],
      assignees: [{id: '33333333-3333-4333-8333-333333333333', display_name: 'เจ้าหน้าที่อีกคน (fixture)'}],
      deliveries: [],
      permissions,
    },
    messages: list,
    notes: [{id: 'n-1', text: 'บันทึกส่วนตัวสังเคราะห์', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:10:00.000Z'}],
    latestSequence: lastSeq,
    readThroughSequence: options.readThrough ?? (Array.isArray(sequences) ? 0 : firstSeq - 1),
    hasMore,
    nextBefore,
  };
}

const LIST_BODY = json({
  tickets: [
    ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI'),
    ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'),
  ],
  unreadCounts: {},
  departments: [],
  assignees: [],
  categories: [],
  pagination: {page: 1, pageSize: 50, total: 2, totalPages: 1, hasNext: false, hasPrevious: false},
});

function baseRoutes() {
  return [
    {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
    {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
    // Room B carries global non-1, non-contiguous sequences across the shared suite.
    {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {sequences: [4, 7, 11], readThrough: 0}))},
    {pattern: '/api/chat/tickets/bbbb.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 11})},
    {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
  ];
}

async function waitForCommitBarrier(page) {
  // Yield past fetch response.json() microtasks, React commit scheduler turns,
  // and two browser animation frames before sampling DOM / URL state.
  await page.evaluate(() => new Promise(resolve => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 40);
        });
      });
    }, 20);
  }));
}

async function configure(page, routes) {
  await page.evaluate(list => { window.__shim.setRoutes(list); }, routes);
}

async function routeCount(page, pattern, method) {
  return page.evaluate(({pattern, method}) => {
    const hit = window.__shim.routeCounts().find(route => route.method === method && route.pattern === pattern);
    return hit ? hit.count : -1;
  }, {pattern, method});
}

async function postRequests(page, urlPattern) {
  return page.evaluate(pattern => window.__shim.requestsSnapshot().filter(request =>
    request.method === 'POST' && new RegExp(pattern).test(request.url)), urlPattern);
}

async function clickRow(page, index) {
  await page.locator('.inbox-ticket-row').nth(index).click();
}

function defer(route, key) {
  return Object.assign({}, route, {mode: 'defer', key});
}

/* ---------------------------------------------------------------------- */
/* Scenario S01 — D1 cross-case lifecycle retry (RED primary evidence)      */
/* ---------------------------------------------------------------------- */

const S01 = {
  id: 'S01-cross-case-lifecycle-retry',
  title: 'P1: lifecycle retry ข้ามเคส (A→B ส่ง body ของ A ไปที่ endpoint B) และ attempt ของ A ต้องไม่หาย',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      ...baseRoutes(),
      // A's accept is a definitive server error (500): the attempt must stay
      // retained; B's accept is deferred so the submit is in-flight and observable.
      {pattern: `/api/tickets/${uuidA}/accept$`, method: 'POST', mode: 'respond', status: 500, body: json({error: 'INTERNAL'})},
      {pattern: `/api/tickets/${uuidB}/accept$`, method: 'POST', mode: 'defer', key: 'accept-b'},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-context') && document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await page.getByRole('button', {name: 'รับเรื่องนี้'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('เซิร์ฟเวอร์ยังยืนยันผลไม่ได้') || document.body.innerText.includes('การเชื่อมต่อขาดหาย'), null, {timeout: 8000, polling: 30});
    const acceptsAfterA = await postRequests(page, '/accept$');
    check(acceptsAfterA.length === 1, 'กรณี A หนึ่งคำขอเดียว', acceptsAfterA);
    const aRequest = acceptsAfterA[0];
    check(new RegExp(`${uuidA}/accept`).test(aRequest.url), 'A ถูกส่งไป endpoint ของ A', aRequest.url);
    check(aRequest.body !== null && JSON.parse(aRequest.body).requestId === aRequest.requestId, 'requestId ใน body ตรงกับที่ถูกจับ', aRequest.requestId);

    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await page.getByRole('button', {name: 'รับเรื่องนี้'}).click();
    // B's own attempt must be its own request: wait until its deferred POST is in flight.
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length > 0, null, {timeout: 8000, polling: 30});
    const acceptsTotal = await postRequests(page, '/accept$');
    check(acceptsTotal.length === 2, 'กรณี B ต้องเป็นคำขอของตัวเอง (รวมสอง POST)', acceptsTotal);
    const bRequest = acceptsTotal[acceptsTotal.length - 1];
    check(new RegExp(`${uuidB}/accept`).test(bRequest.url), 'B POST ไป endpoint ของ B', bRequest.url);
    // DESIRED (GREEN): B's own prompt never carries A's requestId or A's revision.
    const bBody = JSON.parse(bRequest.body);
    const aBody = JSON.parse(aRequest.body);
    check(bBody.requestId !== aBody.requestId, 'ต้องไม่ใช้ requestId ของ A ในคำขอของ B', {a: aBody.requestId, b: bBody.requestId});
    check(bBody.revision !== aBody.revision, 'revision ต้องเป็นของเคส B', {a: aBody.revision, b: bBody.revision});

    // A→B→A: A's unknown attempt must survive selection changes.
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    const retryVisible = await page.locator('button:has-text("ลองส่งซ้ำ")').count();
    check(retryVisible === 1, 'ปุ่มรีไทรของคำขอต้องปรากฏทุกชนิดของความไม่แน่นอน (ไม่พึ่งข้อความไทย)', retryVisible);
    await page.locator('button:has-text("ลองส่งซ้ำ")').first().click();
    await page.waitForFunction(() => window.__shim.requestsSnapshot().filter(request => request.method === 'POST' && /\/accept$/.test(request.url)).length >= 3, null, {timeout: 8000, polling: 30});
    const acceptsFinal = await postRequests(page, '/accept$');
    check(acceptsFinal.length === 3, 'รีไทรต้องเกิดเพียงคำขอเดียวเพิ่ม (สาม POST รวม)', acceptsFinal);
    const retryRequest = acceptsFinal[acceptsFinal.length - 1];
    check(new RegExp(`${uuidA}/accept`).test(retryRequest.url), 'รีไทรของ A ต้องไป endpoint ของ A', retryRequest.url);
    check(JSON.parse(retryRequest.body).requestId === aBody.requestId, 'รีไทรต้องใช้ requestId เดิมของ A', {first: aBody.requestId, retry: JSON.parse(retryRequest.body).requestId});
    check(JSON.parse(retryRequest.body).revision === aBody.revision, 'รีไทรต้องใช้ revision เดิมของ A', retryRequest.body);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S02 — D uncertain lifecycle on invalid success 200             */
/* ---------------------------------------------------------------------- */

const S02 = {
  id: 'S02-invalid-success-200',
  title: '200 ที่ไม่ใช success DTO ต้องถือว่ายังไม่แน่นอน (ไม่ถือว่า committed) และ requestId ต้องรอด',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      ...baseRoutes(),
      {pattern: `/api/tickets/${uuidA}/accept$`, method: 'POST', mode: 'respond', status: 200, body: json({error: 'X_SERIALIZATION_BROKEN'})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await page.getByRole('button', {name: 'รับเรื่องนี้'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('ยืนยันผล') || document.body.innerText.includes('บันทึกการเปลี่ยนแปลงแล้ว'), null, {timeout: 8000, polling: 30});
    const first = (await postRequests(page, '/accept$'))[0];
    const firstBody = JSON.parse(first.body);
    const text = await page.evaluate(() => document.body.innerText);
    check(text.includes('บันทึกการเปลี่ยนแปลงแล้ว') === false, '200 ที่ shape ผิดต้องไม่แสดงเป็นความสำเร็จ', text);
    const retryVisible = await page.locator('button:has-text("ลองส่งซ้ำ")').count();
    check(retryVisible === 1, 'ต้องมีปุ่มรีไทรชัดหลัง invalid success', retryVisible);
    await page.locator('button:has-text("ลองส่งซ้ำ")').first().click();
    const posts = await postRequests(page, '/accept$');
    check(posts.length === 2, 'รีไทรหนึ่งครั้ง', posts);
    const secondBody = JSON.parse(posts[1].body);
    check(secondBody.requestId === firstBody.requestId, 'รีไทรต้องใช้ requestId เดิม', {first: firstBody.requestId, second: secondBody.requestId});
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S03 — D list snapshot erasure after auth denial                */
/* ---------------------------------------------------------------------- */

const S03 = {
  id: 'S03-list-denial-erasure',
  title: '401 ของรายการ: ต้องล้าง list snapshot (ไม่มีแถวให้กด/ค้าง) พร้อม note หมดอายุ',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const firstRoutes = baseRoutes();
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, firstRoutes);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 401, body: json({error: 'UNAUTHENTICATED'})},
      {pattern: '^/api/chat/tickets/.+', method: 'GET', mode: 'respond', status: 401, body: json({error: 'UNAUTHENTICATED'})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 401, body: json({error: 'UNAUTHENTICATED'})},
    ]);
    await page.locator('.inbox-icon-button').click();
    await page.waitForFunction(() => document.body.innerText.includes('เซสชันหมดอายุ'), null, {timeout: 8000, polling: 30});
    const rows = await page.locator('.inbox-ticket-row').count();
    check(rows === 0, 'ต้องไม่มีแถวรายการค้างหลัง 401 (ล้าง list snapshot)', rows);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S04 — detail thread denial clears owner state without callback */
/* ---------------------------------------------------------------------- */

const S04 = {
  id: 'S04-thread-denial-owner-erasure',
  title: '403 ของบทสนทนา (คำขอ current): จะต้องล้างข้อความ/บันทึก/ร่าง/คำขอรอในเจ้าของ state เอง (ไม่มี parent callback)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    // The mount itself is seeded by the fixture boot (no GET); the ONE thread GET
    // that follows the successful note is the denial that must erase owner state.
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}`);
    await configure(page, [
      {pattern: '^/api/chat/tickets/.*$', method: 'GET', mode: 'scripted', queue: [{status: 403, body: json({error: 'NOT_ALLOWED'})}]},
      {pattern: '/api/chat/tickets/.*/notes$', method: 'POST', mode: 'respond', status: 200, body: json({id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:12:00.000Z'})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    // Type a note, submit (success), which triggers a thread refresh that is denied with 403.
    await page.locator('.inbox-note-disclosure summary').click();
    await page.locator('#chat-note').fill('บันทึกที่จะถูกล้างหลังถูกถอนสิทธิ์');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => document.body.innerText.includes('ไม่พบรายการนี้') || document.body.innerText.includes('บันทึกส่วนตัวแล้ว'), null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => document.body.innerText.includes('ไม่พบรายการนี้หรือสิทธิ์ของคุณเปลี่ยนไป'), null, {timeout: 8000, polling: 30});
    const text = await page.evaluate(() => document.body.innerText);
    check(!text.includes('บันทึกที่จะถูกล้างหลังถูกถอนสิทธิ์'), 'ร่างบันทึกต้องไม่ค้างหลังถูกถอนสิทธิ์', text.slice(0, 200));
    const messagesLeft = await page.locator('.inbox-message').count();
    check(messagesLeft === 0, 'ต้องไม่ render ข้อความ cached หลังถูกถอนสิทธิ์', messagesLeft);
    const noteLeft = await page.locator('.inbox-notes li').count();
    check(noteLeft === 0, 'บันทึกส่วนตัว cached ต้องถูกล้าง', noteLeft);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S05 — one current detail authority + assistance revision       */
/* ---------------------------------------------------------------------- */

const S05 = {
  id: 'S05-detail-authority-assist-revision',
  title: 'หลัง refresh: ปุ่ม lifecycle ต้องตามสิทธิ์ล่าสุด + ร่างผู้ช่วยต้องผูก revision ของ record ปัจจุบัน',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const fresh = threadFor(ticketItem(uuidD, 4, 'เคสเด ทาดล กรณี D', 2, 'STAFF_HANDLING', 'HUMAN'), {revision: 8, perms: {accept: true, reply: true, resolve: false, close: false, reassign: false, reopen: false}});
    const assist = json({revision: 8, advice: {ticketSummary: 'สรุป', conversationSummary: 'สรุปบทสนทนา', replyDraft: 'ร่างตอบจากผู้ช่วย', suggestedDepartmentCode: null, suggestedPriority: 'MEDIUM', reason: 'เหตุผล', uncertainties: []}, historyTruncated: false, knowledgeStatus: 'NOT_SEARCHED'});
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}`);
    await configure(page, [
      // Mount seeds the boot thread; the ONE thread GET after the successful note
      // returns the fresh authoritative snapshot (revision 8, authority withdrawn).
      {pattern: '^/api/chat/tickets/.*$', method: 'GET', mode: 'scripted', queue: [{status: 200, body: json(fresh)}]},
      {pattern: '/api/chat/tickets/.*/notes$', method: 'POST', mode: 'respond', status: 200, body: json({id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:12:00.000Z'})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '^/api/tickets/.*/assist$', method: 'POST', mode: 'respond', status: 200, body: assist},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 8})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    // Successful note submission triggers a thread refresh whose authoritative
    // snapshot has revision 8 and withdraws resolve/close/reassign/reopen.
    await page.locator('.inbox-note-disclosure summary').click();
    await page.locator('#chat-note').fill('ข้อความส่ง');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => document.body.innerText.includes('บันทึกบันทึกส่วนตัวแล้ว'), null, {timeout: 8000, polling: 30});
    const reassignButtons = await page.locator('button:has-text("เปลี่ยนผู้รับผิดชอบ")').count();
    check(reassignButtons === 0, 'ปุ่ม lifecycle ที่ถูกถอนสิทธิ์ต้องหายหลังรับ authority ใหม่', reassignButtons);
    // Assistance: fresh AI draft must bind the record's CURRENT revision (8).
    await page.getByRole('button', {name: 'ช่วยสรุปและร่างคำตอบ'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('ร่างคำตอบ'), null, {timeout: 8000, polling: 30});
    await page.getByRole('button', {name: 'นำร่างไปแก้ไขก่อนส่ง'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('นำร่างไปไว้ในช่องตอบกลับแล้ว') || document.body.innerText.includes('ร่างนี้ไม่ตรงกับเคส'), null, {timeout: 8000, polling: 30});
    const composerValue = await page.locator('#chat-reply').inputValue();
    check(composerValue === 'ร่างตอบจากผู้ช่วย', 'ร่างผู้ช่วยต้องเข้าช่องตอบกลับหลังรับ authority ใหม่ (revision จากคำขอจริง)', {composerValue});
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S06 — cross-room history fence (stale response must not write) */
/* ---------------------------------------------------------------------- */

const S06 = {
  id: 'S06-history-fence-cross-room',
  title: 'history ของ A ค้าง → สลับ B → release: ห้ามเขียน record ของ A และห้ามกระพือห้องของ B',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    // A's initial window covers sequences 4..6 and still has history below it;
    // the deferred (resolved late) history window covers 1..3.
    const initialA = json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI'), {messages: 3, seqFrom: 4, hasMore: true, nextBefore: 4}));
    const older = json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI'), {messages: 3, seqFrom: 1, hasMore: false, nextBefore: null}));
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      // Query-specific routes FIRST: the plain-thread route must not swallow
      // beforeSequence fetches (the shim picks the first matching route).
      {pattern: `^/api/chat/tickets/${uuidA}\\?beforeSequence`, method: 'GET', mode: 'defer', key: 'history-a'},
      // The scripted queue carries spare copies so a visible-refresh poll tick
      // cannot drain it and turn the flow into an empty-window response.
      {pattern: `^/api/chat/tickets/${uuidA}\\?limit`, method: 'GET', mode: 'scripted', queue: Array.from({length: 6}, () => ({status: 200, body: initialA}))},
      {pattern: `^/api/chat/tickets/${uuidB}\\?limit`, method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN')))},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 6})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('button:has-text("โหลดข้อความก่อนหน้า")').click();
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length > 0, null, {timeout: 8000, polling: 30});
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.evaluate(({key, body}) => window.__shim.resolveDeferred(key, {status: 200, body}), {key: 'history-a', body: older});
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-message') !== null, null, {timeout: 8000, polling: 30});
    const visible = await page.evaluate(() => Array.from(document.querySelectorAll('.inbox-message-bubble p')).map(node => node.textContent));
    check(visible.length === 3, 'stale history response ห้ามเขียนรายชื่อข้อความลง record ของ A', visible);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S07 — page out of range recovery (page=10000, total>0)         */
/* ---------------------------------------------------------------------- */

const S07 = {
  id: 'S07-page-out-of-range-recovery',
  title: 'page=10000 กับ total>0,tickets=[]: ต้องมี recovery แบบ out-of-range (ไม่อ้าง total ธรรมดา)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const overflowBody = json({tickets: [], unreadCounts: {}, departments: [], assignees: [], categories: [], pagination: {page: 10000, pageSize: 25, total: 42, totalPages: 2, hasNext: false, hasPrevious: true}});
    await page.goto(`${BASE}:${port}/fixture/inbox?page=10000`);
    await configure(page, [
      // First list fetch answers the overflow page; after the user clicks the
      // recovery button (page 1) the next fetch must return rows.
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'scripted', queue: [{status: 200, body: overflowBody}, {status: 200, body: LIST_BODY}, {status: 200, body: LIST_BODY}, {status: 200, body: LIST_BODY}, {status: 200, body: LIST_BODY}]},
      {pattern: '^/api/chat/tickets/', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.waitForFunction(() => document.body.innerText.includes('กลับไปหน้าแรก'), null, {timeout: 8000, polling: 30});
    const preRecovery = await page.evaluate(() => document.body.innerText);
    check(preRecovery.includes('หน้าที่ระบุไม่มีรายการ') && !preRecovery.includes('42 รายการ'), 'page เกิน totalPages ต้องอ้าง out-of-range ไม่ใช่ total ธรรมดา', preRecovery.slice(0, 200));
    await page.locator('button:has-text("กลับไปหน้าแรก")').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    const healed = await page.evaluate(() => document.body.innerText);
    check(!healed.includes('กลับไปหน้าแรก') && !healed.includes('42 รายการ'), 'กลับไปหน้าแรกแล้ว recovery ต้องหายและไม่แสดง total เก่า', healed.slice(0, 250));
    const listGets = await page.evaluate(() => window.__shim.requestsSnapshot().filter(request => request.url.includes('/api/chat/inbox')).map(request => request.url));
    check(listGets.length === 2 && /page=1&/.test(listGets[1]), 'recovery ต้องออกหน้า 1 หนึ่งคำขอพอดี', listGets);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S08 — duplicate query params must not silently pick first      */
/* ---------------------------------------------------------------------- */

const S08 = {
  id: 'S08-duplicate-params-visible-recovery',
  title: 'view=mine&view=all: key ซ้ำต้องแจ้งและไม่ส่งค่าแรกเงียบ ๆ',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox?view=mine&view=all`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: '^/api/chat/tickets/', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    const noteVisible = await page.locator('.inbox-dropped-note').count();
    check(noteVisible === 1, 'dup key ซ้ำต้องแสดง note ระบุถูกข้าม (recovery ตามสัญญา)', noteVisible);
    const listRequests = await page.evaluate(() => window.__shim.requestsSnapshot().filter(request => request.url.includes('/api/chat/inbox') && request.url.includes('view=')));
    const last = listRequests[listRequests.length - 1];
    const matches = last.url.match(/view=[\w]+/g) ?? [];
    check(matches.length === 1, 'backend ต้องได้ค่า view เดียว ไม่ใช่สองค่าจาก URL ซ้ำ', last.url);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S09 — mobile focus transfer + reduced motion + bounds          */
/* ---------------------------------------------------------------------- */

const S09 = {
  id: 'S09-mobile-focus-transfer',
  title: '390×844: คลิกแถว/ปุ่มย้อนกลับ ต้องไม่ทิ้ง focus ใน display:none; reduced motion; composer ไม่หลุดจอ',
  viewport: {width: 390, height: 844},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    const afterSelect = await page.evaluate(() => ({
      tag: document.activeElement && document.activeElement.tagName,
      connected: document.activeElement ? document.activeElement.isConnected : false,
      hidden: document.activeElement ? getComputedStyle(document.activeElement).display === 'none' : true,
      backVisible: Boolean(document.querySelector('.inbox-back-mobile')),
    }));
    check(afterSelect.hidden === false, 'เลือกแถวแล้ว focus ต้องไม่อยู่ใน element ที่ display:none', afterSelect);
    check(afterSelect.connected && afterSelect.tag === 'BUTTON', 'ต้องมี element รับ focus ต่อ (transfer focus เข้า pane)', afterSelect);
    await page.locator('.inbox-back-mobile').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    const afterBack = await page.evaluate(() => ({
      tag: document.activeElement && document.activeElement.tagName,
      connected: document.activeElement ? document.activeElement.isConnected : false,
      hidden: document.activeElement ? getComputedStyle(document.activeElement).display === 'none' : true,
      inQueue: document.activeElement ? Boolean(document.activeElement.closest('.inbox-queue')) : false,
    }));
    check(afterBack.connected === true, 'back ต้องคืน focus ให้แถวเดิม/queue heading เสมอ', afterBack);
    check(afterBack.hidden === false, 'focus ต้องไม่อยู่ใน display:none หลังกดย้อนกลับ', afterBack);
    // Reduced motion: the queue transition must be disabled (the shipped CSS
    // promises `transition-duration:.01ms !important` under prefers-reduced-motion inbound).
    await page.emulateMedia({reducedMotion: 'reduce'});
    // getComputedStyle normalises durations ("0.01ms" arrives as "1e-05s"), so
    // the evidence compares numeric milliseconds — the promise stays immutable:
    // the row transition must be effectively disabled (<= .01ms).
    const rowTransition = await page.evaluate(() => {
      const raw = getComputedStyle(document.querySelector('.inbox-ticket-row')).transitionDuration;
      const value = parseFloat(raw);
      const toMs = /ms$/.test(raw) ? value : value * 1000;
      return {raw, ms: toMs};
    });
    check(rowTransition.raw === '0s' || (Number.isFinite(rowTransition.ms) && rowTransition.ms > 0 && rowTransition.ms <= 0.02), 'reduced motion ต้องปิด transition ของแถว', rowTransition);
    await page.setViewportSize({width: 320, height: 844});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-reply-form') !== null, null, {timeout: 8000, polling: 30});
    const composerBox = await page.evaluate(() => {
      const form = document.querySelector('.inbox-reply-form');
      const rect = form.getBoundingClientRect();
      return {left: rect.left, right: rect.right, viewport: window.innerWidth};
    });
    check(composerBox.left >= -1 && composerBox.right <= composerBox.viewport + 1, 'composer ต้องไม่หลุดขอบจอที่ 320px', composerBox);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S10 — detail route refetch on private invalidation             */
/* ---------------------------------------------------------------------- */

const S10 = {
  id: 'S10-detail-private-invalidation-refetch',
  title: 'detail route: ต้อง subscribe private channel + refetch authorized เมื่อรับ invalidate marker',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const thread = threadFor(ticketItem(uuidD, 4, 'เคสเด ทาดล กรณี D', 2, 'STAFF_HANDLING', 'HUMAN'));
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}`);
    await configure(page, [
      {pattern: '^/api/chat/tickets/dddd', method: 'GET', mode: 'scripted', queue: [{status: 200, body: json(thread)}, {status: 200, body: json(thread)}, {status: 200, body: json(thread)}]},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    // The detail route at HEAD has no supabase wiring yet (D8 defect); every
    // access below must degrade to "no channels" instead of throwing, so the
    // scenario yields check-level RED evidence rather than a raw exception.
    const channels = await page.evaluate(() => (window.__supabaseFixture ? window.__supabaseFixture.channels() : []).map(ch => ({name: ch.name, config: ch.config})));
    check(channels.length === 1 && channels[0].name === 'staff:staff-fixture-a:inbox', 'ต้อง subscribe private channel staff:<actorId>:inbox', channels);
    check(channels[0] && channels[0].config && channels[0].config.private === true, 'channel ต้อง config private', channels);
    await page.evaluate(() => { const fixture = window.__supabaseFixture; if (!fixture) return; const channel = fixture.channel('staff:staff-fixture-a:inbox'); if (channel) channel.fireInvalidate(); });
    await page.waitForFunction(() => window.__shim.routeCounts().find(route => route.pattern === '^/api/chat/tickets/dddd' && route.method === 'GET' && route.count >= 2) !== undefined, null, {timeout: 8000, polling: 30});
    // Unmount: the fixture button unmounts the React root in this SAME document
    // so cleanup effects stay observable (a full navigation would wipe the
    // per-document supabase fixture and channel bookkeeping).
    await page.locator('button[data-fixture="unmount"]').click();
    await page.waitForFunction(() => (window.__supabaseFixture ? window.__supabaseFixture.removed() : []).includes('staff:staff-fixture-a:inbox'), null, {timeout: 8000, polling: 30});
    const removed = await page.evaluate(() => window.__supabaseFixture.removed());
    check(removed.length === 1 && removed.includes('staff:staff-fixture-a:inbox'), 'unmount ต้อง removeChannel ของตัวเอง และห้ามปล่อย channel อื่น', removed);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S16 — CX1: list denial must reset the WHOLE actor workspace     */
/* ---------------------------------------------------------------------- */

const S16 = {
  id: 'S16-list-denial-actor-reset',
  title: 'list denial ทั้ง actor: กลับเข้าห้อง A หลัง recovery ต้องไม่เผยบันทึกส่วนตัว/ร่างเก่าก่อน GET ใหม่ยืนยันสิทธิ์',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    // Phase 1: seed the private room A (messages + PRIVATE draft) exactly like
    // an operator who has been reading the thread.
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('#chat-reply').fill('PRIVATE_DRAFT_A');

    // Phase 2: the LIST API denies the actor (403). The list and the current
    // selection must be surrendered (S03 behavior already frozen at HEAD);
    // the counterexample is everything the ops workspace KEEPS after that.
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 403, body: json({error: 'FORBIDDEN'})},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN')))},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.locator('.inbox-icon-button[aria-label="โหลดรายการใหม่"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 0, null, {timeout: 8000, polling: 30});
    check((await page.evaluate(() => document.querySelectorAll('.inbox-ticket-row').length)) === 0, '403 ของ list ต้องล้างแถวทั้งหมด (S03 behaviour)', 'list-cleared');

    // Phase 3: the list recovers; A's fresh thread GET is DEFERRED. While the
    // fresh GET is still pending NOTHING private may surface — no cached
    // record, no restored draft, no notes pane.
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'defer', key: 'get-a'},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN')))},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.locator('.inbox-ticket-row').first().click();
    await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'GET' && request.url.includes('/aaaa')), null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('get-a')), null, {timeout: 8000, polling: 30});
    const leakProbe = await page.evaluate(() => ({
      pendingGet: window.__shim.deferredKeys().some(key => key.startsWith('get-a')),
      messageCount: document.querySelectorAll('.inbox-message').length,
      notePanelPresent: document.querySelector('.inbox-note-disclosure') !== null,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(leakProbe.pendingGet, 'fresh GET ของ A ยังค้าง (ภาวะที่ต้องไม่เผยข้อมูลเก่า)', leakProbe);
    check(leakProbe.messageCount === 0, 'ห้ามเผยข้อความเก่าของ A ก่อน GET ใหม่ยืนยันสิทธิ์', leakProbe);
    check(!leakProbe.notePanelPresent, 'ห้ามเผยบันทึกส่วนตัวเก่าของ A ก่อน GET ใหม่ยืนยันสิทธิ์', leakProbe);
    check(leakProbe.draftValue === '' || leakProbe.draftValue === null, 'ร่างข้อความเก่าของ A ต้องถูกล้างพร้อม authority (ห้ามโผล่กลับ)', leakProbe);

    // Phase 4: the fresh GET confirms current authority → the room renders
    // FRESH truth and the private draft stays erased.
    const freshThread = threadFor(ticketItem(uuidA, 1, 'ข้อความหลังเพิกถอนสิทธิ์ A', 3, 'WAITING_STAFF', 'AI'));
    await page.evaluate(answer => window.__shim.resolveDeferred('get-a#1', answer), {status: 200, body: JSON.parse(JSON.stringify(freshThread))});
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    const confirmed = await page.evaluate(() => ({
      messageCount: document.querySelectorAll('.inbox-message').length,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(confirmed.messageCount >= 3, 'หลัง GET ใหม่สำเร็จ ห้องแสดงข้อมูล truth ปัจจุบันตามปกติ', confirmed);
    check(confirmed.draftValue === '' || confirmed.draftValue === null, 'หลัง denial+recovery ร่างเก่ายังต้องหายไปจริง (ไม่ฟื้น)', confirmed);

    // Phase 5 (Root exact repro): B is currently SELECTED when list returns 403
    // (open A + type draft -> open B -> list 403 -> list 200 with GET A deferred -> select A).
    await configure(page, baseRoutes());
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('#chat-reply').fill('PRIVATE_DRAFT_A_B_SELECTED');
    await clickRow(page, 1);
    await page.waitForFunction(() => window.location.search.includes('bbbb') && document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 403, body: json({error: 'FORBIDDEN'})},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {sequences: [4, 7, 11], readThrough: 0}))},
      {pattern: '/api/chat/tickets/bbbb.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 11})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.locator('.inbox-icon-button[aria-label="โหลดรายการใหม่"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 0, null, {timeout: 8000, polling: 30});
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'defer', key: 'get-a-after-b'},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {sequences: [4, 7, 11], readThrough: 0}))},
      {pattern: '/api/chat/tickets/bbbb.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 11})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.locator('.inbox-icon-button[aria-label="โหลดรายการใหม่"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('get-a-after-b')), null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const reproProbe = await page.evaluate(() => ({
      pendingGet: window.__shim.deferredKeys().some(key => key.startsWith('get-a-after-b')),
      messageCount: document.querySelectorAll('.inbox-message').length,
      notePanelPresent: document.querySelector('.inbox-note-disclosure') !== null,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(reproProbe.pendingGet, 'Root repro (B selected ตอน list 403): fresh GET ของ A ยังค้าง', reproProbe);
    check(reproProbe.messageCount === 0, 'Root repro: ห้ามเผยข้อความเก่าของ A ก่อน GET ใหม่แม้ตอน 403 เปิด B อยู่', reproProbe);
    check(!reproProbe.notePanelPresent, 'Root repro: ห้ามเผยบันทึกส่วนตัวเก่าของ A ก่อน GET ใหม่แม้ตอน 403 เปิด B อยู่', reproProbe);
    check(reproProbe.draftValue === '' || reproProbe.draftValue === null, 'Root repro: ร่างเก่าของ A ต้องถูกล้างด้วยแม้ตอน 403 เปิด B อยู่', reproProbe);
    await page.evaluate(answer => window.__shim.resolveDeferred('get-a-after-b#1', answer), {status: 200, body: JSON.parse(JSON.stringify(freshThread))});
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const reproConfirmed = await page.evaluate(() => ({
      messageCount: document.querySelectorAll('.inbox-message').length,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(reproConfirmed.messageCount >= 3, 'Root repro: หลัง fresh GET A สำเร็จแสดงผลตามปกติ', reproConfirmed);
    check(reproConfirmed.draftValue === '' || reproConfirmed.draftValue === null, 'Root repro: ร่างเก่าของ A ไม่ฟื้นกลับหลัง recovery', reproConfirmed);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S17 — CX2: read-ack denial touches only the denied room         */
/* ---------------------------------------------------------------------- */

const S17 = {
  id: 'S17-read-ack-denial-scoped-room',
  title: 'read-ack 403 ของ A ต้องไม่ปิดห้อง B ที่กำลังเปิด; ร่างของ B คงอยู่; กลับ A→B→A ต้องยืนยันใหม่',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN')))},
      {pattern: '^/api/chat/tickets/aaaa.*/read$', method: 'POST', mode: 'defer', key: 'read-a'},
      {pattern: '^/api/chat/tickets/bbbb.*/read$', method: 'POST', mode: 'defer', key: 'read-b'},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    // Open A: its read-ack POST goes out and stays deferred.
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && request.url.includes('aaaa') && request.url.includes('/read')), null, {timeout: 8000, polling: 30});
    // Open B on top of the hung A ack; type a PRIVATE draft in B.
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('#chat-reply').fill('PRIVATE_DRAFT_B');
    const inboxCountBefore = await routeCount(page, '^/api/chat/inbox', 'GET');
    const before = await page.evaluate(() => ({
      messages: document.querySelectorAll('.inbox-message').length,
      draft: (document.querySelector('#chat-reply') || {}).value ?? null,
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      urlSearch: window.location.search,
      pendingReads: Object.keys(window.__shim.deferredKeys()),
    }));
    check(before.draft === 'PRIVATE_DRAFT_B', 'ข้อความร่างใน B พร้อมก่อน denial ของ A', before);
    check(before.urlSearch.includes(uuidB), 'URL ชี้ห้อง B ก่อน denial ของ A', before);
    // A's stale read-ack answers 403 WHILE B IS OPEN.
    await page.evaluate(() => window.__shim.resolveDeferred('read-a#1', {status: 403, body: JSON.stringify({error: 'FORBIDDEN'})}));
    await page.waitForFunction(() => !window.__shim.deferredKeys().includes('read-a#1'), null, {timeout: 8000, polling: 30});
    await page.waitForFunction(earlier => (window.__shim.routeCounts().find(route => route.method === 'GET' && route.pattern === '^/api/chat/inbox') || {count: earlier}).count > earlier, inboxCountBefore, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const after = await page.evaluate(() => ({
      messages: document.querySelectorAll('.inbox-message').length,
      draft: (document.querySelector('#chat-reply') || {}).value ?? null,
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      urlSearch: window.location.search,
      pendingReads: Object.keys(window.__shim.deferredKeys()),
    }));
    check(after.messages >= 3, 'read-ack 403 ของ A ต้องไม่ปิดห้อง B ที่กำลังเปิด (403 ของ A ปิดเฉพาะ A)', after);
    check(after.draft === 'PRIVATE_DRAFT_B', 'ร่างของ B ต้องไม่หายเพราะ read-ack ของ A ถูก 403', after);
    check(after.urlSearch.includes(uuidB), 'URL ของห้อง B ต้องยังชี้ห้อง B หลัง commit (ไม่ถูก replace ออก)', after);
    check(after.notice === before.notice && !(after.notice || '').includes('ไม่แสดงให้คุณอีกต่อไป'), 'notice ของ B ต้องไม่เปลี่ยนเป็น error การปิดห้อง A หลัง commit', {beforeNotice: before.notice, afterNotice: after.notice});
    // A→B→A reauthorization: returning to A must re-verify fresh (A's snapshot
    // was lost with the denial); the round trip must not corrupt anything.
    const aGetBefore = await routeCount(page, '^/api/chat/tickets/aaaa', 'GET');
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const aGetAfter = await routeCount(page, '^/api/chat/tickets/aaaa', 'GET');
    const returned = await page.evaluate(() => document.querySelectorAll('.inbox-message').length);
    check(returned >= 3 && aGetAfter > aGetBefore, 'กลับเข้า A หลัง denial ต้องโหลดใหม่จริงและแสดงผลได้ตามปกติ', {returned, aGetBefore, aGetAfter});
    // Back to B: B's state must have survived the whole round trip.
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const bAfterRoundTrip = await page.evaluate(() => ({
      draft: (document.querySelector('#chat-reply') || {}).value ?? null,
      urlSearch: window.location.search,
    }));
    check(bAfterRoundTrip.draft === 'PRIVATE_DRAFT_B' && bAfterRoundTrip.urlSearch.includes(uuidB), 'ร่างและ URL ของ B ต้องรอดข้าม A→B→A ทั้งเที่ยว', bAfterRoundTrip);
    check((await page.evaluate(() => document.querySelectorAll('.inbox-ticket-row').length)) === 2, 'หน้ารายการยังอยู่ครบสองแถว (sanity)', 'rows');
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S18 — CX3: A's stale note completion never surfaces in B        */
/* (runs BOTH paths on the valid-JSON harness; B stays usable meanwhile)    */
/* ---------------------------------------------------------------------- */

const S18 = {
  id: 'S18-stale-note-completion-scoped-room',
  title: 'note ของ A ค้าง → B ยังใช้งานได้ (ส่งคำตอบได้) + ผล 200/5xx ของ A ต้องไม่เปลี่ยน notice/busy ของ B; กลับมาที่ A ต้องเห็นผลของ A ตามจริง',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: '^/api/chat/tickets/aaaa', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI')))},
      {pattern: '^/api/chat/tickets/bbbb', method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN')))},
      {pattern: '^/api/chat/tickets/aaaa.*/notes$', method: 'POST', mode: 'defer', key: 'note-a'},
      {pattern: '^/api/tickets/bbbb.*reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidB, status: 'STAFF_HANDLING', revision: 6})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    // A: fire a note that stays deferred.
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-note-disclosure') !== null, null, {timeout: 8000, polling: 30});
    await page.evaluate(text => {
      const disclosure = document.querySelector('.inbox-note-disclosure');
      if (disclosure) disclosure.setAttribute('open', '');
      const area = document.querySelector('#chat-note');
      if (area) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, text);
        area.dispatchEvent(new Event('input', {bubbles: true}));
      }
    }, 'บันทึก A ล่าช้า');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('note-a')), null, {timeout: 8000, polling: 30});
    // B while A's request is hanging: B's composer must be FULLY usable.
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('#chat-reply').fill('คำตอบจาก B ที่ส่งได้ตอน A ค้าง');
    // Record the composer's availability AS EVIDENCE before any click: the
    // defect at HEAD keeps the button disabled (single global busy) even
    // though room B's own note/reply is permitted and A's request merely
    // hangs. The click attempt below must not abort the scenario — the
    // "no POST fired" outcome is itself recorded as a failed check.
    const bComposer = await page.evaluate(() => {
      const button = document.querySelector('.inbox-reply-form button[type="submit"]');
      return {buttonDisabled: button ? button.disabled : null, draft: (document.querySelector('#chat-reply') || {}).value ?? null};
    });
    check(bComposer.buttonDisabled !== true, 'ห้อง B ต้องยังส่งได้ตอน note ของ A ค้าง (busy ต้องแยกตามห้อง)', bComposer);
    await page.locator('.inbox-reply-form button[type="submit"]').click({timeout: 2500}).catch(() => null);
    const bReplyFired = await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && request.url.includes('bbbb') && request.url.includes('/reply')), null, {timeout: 6000, polling: 30}).then(() => true).catch(() => false);
    check(bReplyFired, 'ห้อง B ต้องยิง POST /reply ได้จริงตอน A ค้าง (ห้ามเสีย request ไป)', 'b-reply-post');
    const bNoticeFired = await page.waitForFunction(() => {
      const notice = document.querySelector('.inbox-notice');
      return Boolean(notice && notice.textContent.includes('บันทึกคำตอบแล้ว'));
    }, null, {timeout: 6000, polling: 30}).then(() => true).catch(() => false);
    const bNotice = bNoticeFired ? (await page.evaluate(() => (document.querySelector('.inbox-notice') || {}).textContent ?? null)) : null;
    check(Boolean(bNoticeFired), 'ห้อง B แสดง notice สำเร็จของการส่งคำตอบของ B เอง', {bNotice});
    const bStayed = await page.evaluate(() => ({
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      urlSearch: window.location.search,
    }));
    // A typed note draft in B makes the note submit button a clean busy probe:
    // after resolving A's note, that button is disabled IFF leaked busy says so.
    await page.evaluate(text => {
      const disclosure = document.querySelector('.inbox-note-disclosure');
      if (disclosure) disclosure.setAttribute('open', '');
      const area = document.querySelector('#chat-note');
      if (area) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, text);
        area.dispatchEvent(new Event('input', {bubbles: true}));
      }
    }, 'บันทึก B ล่วงหน้า (ยังไม่ส่ง)');
    // Success path: A's note 200 with a VALID note DTO (harness serializes it
    // as real HTTP JSON since the H1 fix).
    await page.evaluate(() => window.__shim.resolveDeferred('note-a#1', {status: 200, body: {id: 'note-a-1', text: 'บันทึก A ล่าช้า', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:13:00.000Z'}}));
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const afterSuccess = await page.evaluate(() => ({
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      noteSubmitDisabled: (document.querySelector('.inbox-note-disclosure form button[type="submit"]') || {}).disabled ?? null,
      urlSearch: window.location.search,
    }));
    check(afterSuccess.notice === bStayed.notice, 'ผล 200 ของ note ของ A ต้องไม่เปลี่ยน notice ของ B หลัง React commit (ห้ามโชว์ success ของ B)', afterSuccess);
    check(afterSuccess.noteSubmitDisabled === false, 'busy ของ A ต้องไม่ล็อก composer ของ B (ปุ่มบันทึกของ B ต้องพร้อมใช้)', afterSuccess);
    check(afterSuccess.urlSearch === bStayed.urlSearch && afterSuccess.urlSearch.includes(uuidB), 'URL ของ B ต้องคงเดิมหลังผล 200 ของ A', afterSuccess);
    // Back in A: A must surface ITS OWN honest outcome (confirming A stored it).
    await clickRow(page, 0);
    const aNoticeFired = await page.waitForFunction(() => {
      const notice = document.querySelector('.inbox-notice');
      return Boolean(notice && notice.textContent.includes('บันทึกบันทึกส่วนตัวแล้ว'));
    }, null, {timeout: 6000, polling: 30}).then(() => true).catch(() => false);
    const aNotice = aNoticeFired ? (await page.evaluate(() => (document.querySelector('.inbox-notice') || {}).textContent ?? null)) : null;
    check(Boolean(aNoticeFired), 'กลับมาห้อง A ต้องเห็นผลสำเร็จของ note ของ A ตามจริง', {aNotice});
    // Uncertain path: A's SECOND note hangs; resolves 5xx while B is open —
    // B's notice must stay B's own, and A keeps its attempt honestly.
    // (The open/visible choreography races room swaps — set the controlled
    // value directly with the native setter, exactly what Playwright's fill does.)
    await page.evaluate(text => {
      const disclosure = document.querySelector('.inbox-note-disclosure');
      if (disclosure) disclosure.setAttribute('open', '');
      const area = document.querySelector('#chat-note');
      if (area) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, text);
        area.dispatchEvent(new Event('input', {bubbles: true}));
      }
    }, 'บันทึก A ครั้งสอง');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('note-a#2')), null, {timeout: 8000, polling: 30});
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    const bBeforeError = await page.evaluate(() => ({
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      urlSearch: window.location.search,
    }));
    await page.evaluate(() => window.__shim.resolveDeferred('note-a#2', {status: 500, body: {error: 'INTERNAL'}}));
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const afterError = await page.evaluate(() => ({
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      urlSearch: window.location.search,
    }));
    check(afterError.notice === bBeforeError.notice, 'ผล 5xx ของ note ของ A ต้องไม่เปลี่ยน notice ของ B หลัง React commit', {bBeforeError, afterError});
    check(afterError.urlSearch === bBeforeError.urlSearch && afterError.urlSearch.includes(uuidB), 'URL ของ B ต้องคงเดิมหลังผล 5xx ของ A', afterError);
    await clickRow(page, 0);
    const aUncertainFired = await page.waitForFunction(() => {
      const notice = document.querySelector('.inbox-notice');
      return Boolean(notice && notice.textContent.includes('ยังยืนยันผลไม่ได้'));
    }, null, {timeout: 6000, polling: 30}).then(() => true).catch(() => false);
    const aUncertain = aUncertainFired ? (await page.evaluate(() => (document.querySelector('.inbox-notice') || {}).textContent ?? null)) : null;
    check(Boolean(aUncertainFired), 'กลับมาห้อง A ต้องเห็นสถานะ uncertain ของ note ที่ค้างตามจริง', {aUncertain});
  },
};


/* ---------------------------------------------------------------------- */

const S11 = {
  id: 'S11-stale-note-notice-cross-room',
  title: 'submit ของ A ค้าง → สลับ B → ผลสำเร็จของ A ต้องไม่กระพือ notice/Busy ของห้อง B',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      ...baseRoutes(),
      {pattern: '/api/chat/tickets/aaaa.*/notes$', method: 'POST', mode: 'defer', key: 'note-a'},
      {pattern: '/api/chat/tickets/.*/notes$', method: 'POST', mode: 'respond', status: 200, body: json({id: 'note-b', text: 'บันทึก B', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:14:00.000Z'})},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidB, status: 'STAFF_HANDLING', revision: 6})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-note-disclosure') !== null, null, {timeout: 8000, polling: 30});
    await page.locator('.inbox-note-disclosure summary').click();
    await page.locator('#chat-note').fill('บันทึก A ล่าช้า');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length > 0, null, {timeout: 8000, polling: 30});
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelector('.inbox-note-disclosure') !== null, null, {timeout: 8000, polling: 30});
    await page.evaluate(answer => window.__shim.resolveDeferred('note-a#1', answer), {status: 200, body: {id: 'note-a-1', text: 'บันทึก A ล่าช้า', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:13:00.000Z'}});
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length === 0, null, {timeout: 8000, polling: 30});
    const released = await page.evaluate(() => {
      const notices = Array.from(document.querySelectorAll('.inbox-notice')).map(node => node.textContent);
      return JSON.parse(JSON.stringify({notices}));
    });
    check(Object.keys(released.notices).length === 0 || !released.notices.join('|').includes('บันทึกบันทึกส่วนตัวแล้ว'),
      'ผลของ A ที่ผ่านมาแล้วต้องไม่แสดง notice ในห้อง B (มาจากห้องที่ผู้ใช้กำลังดูอยู่)', released);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S12 — apply form: same-tick double submit sends one request    */
/* ---------------------------------------------------------------------- */

const S12 = {
  id: 'S12-apply-double-submit-one-request',
  title: 'onboarding apply: กดยื่นสองครั้งใน tick เดียวต้องยิง HTTP ครั้งเดียวด้วย requestId เดียว',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/apply`);
    await configure(page, [
      {pattern: '^/api/staff/onboarding$', method: 'GET', mode: 'respond', status: 200, body: json({
        authenticated: true, lineLinked: true, staffActive: false, loginAvailable: true, canReview: false, application: null,
        departments: [{id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'}],
      })},
      {pattern: '^/api/staff/applications$', method: 'POST', mode: 'respond', status: 503, body: json({error: 'INTERNAL'})},
    ]);
    await page.waitForFunction(() => document.getElementById('staff-onboard-name') !== null, null, {timeout: 8000, polling: 30});
    await page.locator('#staff-onboard-name').fill('ผู้สมัครซ้อมซับมิตซ้ำ');
    await page.locator('#staff-onboard-code').fill('STFF-9001');
    await page.selectOption('#staff-onboard-department', '44444444-4444-4444-8444-444444444444');
    await page.evaluate(() => {
      const button = document.querySelector('button[type="submit"]');
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && request.url.includes('/api/staff/applications')), null, {timeout: 8000, polling: 30});
    await page.waitForTimeout(150);
    const posts = await page.evaluate(() => window.__shim.requestsSnapshot().filter(request => request.method === 'POST' && request.url.includes('/api/staff/applications')));
    check(posts.length === 1, 'double click ใน tick เดียวต้องยิง HTTP ครั้งเดียว', posts);
    const ids = posts.map(post => post.requestId).filter(value => value !== null);
    check(new Set(ids).size === 1, 'requestId ต้องเดียวต่อการส่ง', ids);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S13 — late history response never resets authority/delivery    */
/* ---------------------------------------------------------------------- */

const S13 = {
  id: 'S13-history-no-authority-regression',
  title: 'history response (เก่าแก่) ห้ามทับ detail/permissions และห้ามลด deliveryStatus ของข้อความ',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const staleHistory = threadFor(ticketItem(uuidD, 4, 'เคสเด ทาดล กรณี D', 2, 'STAFF_HANDLING', 'HUMAN'), {revision: 3, perms: {accept: true, reply: false, resolve: true, close: true, reassign: true, reopen: true}, messages: 2, seqFrom: 1, hasMore: false, nextBefore: null, delivery: 'PENDING'});
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}&messages=2&seqFrom=3&hasMore=1&nextBefore=3&readThrough=2`);
    await configure(page, [
      // The mount is boot-seeded (window seq 3..4, hasMore, nextBefore 3, no reply loss);
      // only the beforeSequence fetch of the "earlier" button is answered, with a window
      // that carries STALE detail/permissions.
      {pattern: '^/api/chat/tickets/..*\\?beforeSequence', method: 'GET', mode: 'respond', status: 200, body: json(staleHistory)},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 2, null, {timeout: 8000, polling: 30});
    const badgesBefore = await page.evaluate(() => Array.from(document.querySelectorAll('.inbox-delivery')).map(node => node.textContent));
    check(badgesBefore.some(item => item.includes('ส่งแล้ว')), 'ต้องมี badge ส่งแล้วก่อนโหลด history', badgesBefore);
    await page.locator('button:has-text("โหลดข้อความก่อนหน้า")').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 4, null, {timeout: 8000, polling: 30});
    const badgesAfter = await page.evaluate(() => Array.from(document.querySelectorAll('.inbox-delivery')).map(node => node.textContent));
    check(badgesAfter.some(item => item.includes('ส่งแล้ว')), 'badge ของข้อความเดิมต้องไม่ย้อนถอยเป็น รอส่ง', badgesAfter);
    const composerVisible = await page.locator('.inbox-reply-form').count();
    check(composerVisible === 1, 'สิทธิ์ตอบกลับจาก snapshot ใหม่ต้องยังอยู่ (history ห้ามทับ authority)', composerVisible);
    const sequenceOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.inbox-message')).map(() => true).length);
    check(sequenceOrder >= 4, 'โหลดประวัติก่อนหน้าต้องรวมข้อความเก่า 4 ข้อความ', sequenceOrder);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S14 — read acknowledgment only on the rendered visible tail     */
/* ---------------------------------------------------------------------- */

const S14 = {
  id: 'S14-read-ack-rendered-tail',
  title: 'ack เฉพาะ tail ที่ render จริง (throughSequence=tail ไม่ใช้ global latestSequence สูงกว่า)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    // The mount is boot-seeded (messages seq 8..10, readThrough 7): the ack must
    // honor the rendered tail (10), not any global notion of "latest".
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}&messages=3&seqFrom=8&readThrough=7`);
    await configure(page, [
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 10})},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 3})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.url.includes('/read')), null, {timeout: 8000, polling: 30});
    const reads = await page.evaluate(() => window.__shim.requestsSnapshot().filter(request => request.url.includes('/read')));
    check(reads.length >= 1, 'ต้องมีการ ack เมื่อเห็น tail', reads);
    const body = JSON.parse(reads[0].body);
    check(body.throughSequence === 10, 'tail ที่ render คือ seq 10 (ผ่าน seqFrom=8, messages=3)', body);
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S15 — approvals/onboarding backlog (mounted proof, root-fixed)  */
/* ---------------------------------------------------------------------- */

const S15 = {
  id: 'S15-approvals-focus-uncertain-readonly',
  title: 'backlog งานบุคคลบน์ native dialog: focus cycle/inert + uncertain ยังใช้ requestId เดิม (X/Escape) + payload คงเดิม + 409/401 + finished read-only',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const pendingRowBody = json({
      items: [{
        id: '66666666-6666-4666-8666-666666666666', applicantName: 'ผู้สมัครสังเคราะห์', staffCode: 'STFF-0001',
        requestedDepartmentId: '44444444-4444-4444-8444-444444444444', requestedDepartmentName: 'งานทะเบียนสถานศึกษา (fixture)',
        approvedDepartmentId: null, approvedDepartmentName: null, status: 'PENDING', revision: 1,
        submittedAt: '2026-10-28T09:00:00.000Z', reviewedAt: null, reviewerName: null, decisionReason: null,
      }],
      departments: [{id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'}],
      pagination: {page: 1, pageSize: 25, total: 1, totalPages: 1, hasNext: false, hasPrevious: false},
    });
    const settledEmptyBody = json({
      items: [], departments: [{id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'}],
      pagination: {page: 1, pageSize: 25, total: 0, totalPages: 1, hasNext: false, hasPrevious: false},
    });
    await page.goto(`${BASE}:${port}/fixture/approvals`);
    await configure(page, [
      // The client fetches the list itself (no boot items are trusted): the FIRST
      // fetch carries the one PENDING row; the reload after the 409 conflict
      // must find it already settled (empty under PENDING).
      {pattern: '^/api/staff/applications\\?.*status=PENDING', method: 'GET', mode: 'scripted', queue: [
        {status: 200, body: pendingRowBody},
        {status: 200, body: settledEmptyBody},
      ]},
      {pattern: 'api/staff/applications/.*/decision$', method: 'POST', mode: 'defer', key: 'decision'},
    ]);
    // Scope the wait and the click to ROW actions: the PENDING tab label
    // ("รออนุมัติ") also matches the bare :has-text("อนุมัติ") probe and would
    // trigger a filter refetch that erases the row before the dialog opens.
    const rowActions = page.locator('.staff-onboard-row-actions').getByRole('button', {name: 'อนุมัติ', exact: true});
    await rowActions.waitFor({state: 'visible', timeout: 8000});
    await rowActions.click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') !== null, null, {timeout: 8000, polling: 30});
    const focusProbe = await page.evaluate(() => {
      const outside = document.querySelector('h1');
      const before = document.activeElement;
      outside.focus();
      const after = document.activeElement;
      return {
        beforeIsClose: before && before.className.includes('drawer-close'),
        outsideInert: after !== outside,
        modalOpen: Boolean(document.querySelector('dialog[open]')),
      };
    });
    check(focusProbe.modalOpen, 'native dialog เปิด modal', focusProbe);
    check(focusProbe.beforeIsClose, 'initial focus อยู่ที่ปุ่มปิด (focus cycle จัดแล้ว)', focusProbe);
    check(focusProbe.outsideInert, 'พื้นหลังต้อง inert (ห้าม focus ลอดออกนอก dialog)', focusProbe);
    await page.locator('#staff-onboard-final-department').selectOption('44444444-4444-4444-8444-444444444444');
    await page.locator('button:has-text("ยืนยันอนุมัติ")').click();
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length > 0, null, {timeout: 8000, polling: 30});
    const closeDisabled = await page.evaluate(() => {
      const closeButton = document.querySelector('.staff-onboard-drawer-close');
      return closeButton ? closeButton.disabled : null;
    });
    check(closeDisabled === true, 'ระหว่าง pending ปุ่มปิดต้องถูกปิด (กัน retry id หลุด)', closeDisabled);
    await page.keyboard.press('Escape');
    const dialogStillOpen = await page.evaluate(() => Boolean(document.querySelector('dialog[open]')));
    check(dialogStillOpen, 'Escape ระหว่าง retained ต้องไม่ปิด dialog (requestId คงอยู่)', dialogStillOpen);
    const pendingRequest = (await postRequests(page, 'decision$'))[0];
    await page.evaluate(answer => window.__shim.resolveDeferred('decision#1', answer), {status: 503, body: {error: 'INTERNAL'}});
    await page.waitForFunction(() => document.body.innerText.includes('ยังยืนยันผลการบันทึกไม่ได้'), null, {timeout: 8000, polling: 30});
    await page.locator('button:has-text("ยืนยันอนุมัติ")').click();
    const decisions = await postRequests(page, 'decision$');
    check(decisions.length === 2, 'รีไทรหลัง uncertain ยิงต่อ', decisions);
    const secondBody = JSON.parse(decisions[1].body);
    check(secondBody.requestId === pendingRequest.requestId, 'รีไทรต้องใช้ requestId เดิม', {first: pendingRequest.requestId, second: secondBody.requestId});
    check(JSON.stringify(secondBody) === JSON.stringify(JSON.parse(pendingRequest.body)), 'payload ของผู้สมัครต้อง immutable ระหว่าง uncertain retry', {first: pendingRequest.body, second: decisions[1].body});
    await page.evaluate(answer => window.__shim.resolveDeferred('decision#2', answer), {status: 409, body: {error: 'CONFLICT'}});
    // The conflict notice only flashes until the reload lands; the durable
    // settled markers are the missing-draft notice and the filtered empty list.
    await page.waitForFunction(() => document.body.innerText.includes('ไม่อยู่ในรายการล่าสุด'), null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => document.body.innerText.includes('ไม่มีคำขอในสถานะนี้'), null, {timeout: 8000, polling: 30});
    // The applicant name legitimately remains in the retained draft drawer; the
    // ROW itself must be gone, so scope the probe to list row titles.
    const rowAfter409 = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-onboard-row-title')).some(node => (node.textContent || '').includes('ผู้สมัครสังเคราะห์')));
    check(rowAfter409 === false, 'หลัง 409 แถว (PENDING) ต้องออกจากรายการที่กรอง', rowAfter409);
  },
};

  /* ---------------------------------------------------------------------- */
  /* Scenario S19 — realtime lane phases + hidden/offline gates (OP06-09)     */
  /* ---------------------------------------------------------------------- */

  const S19 = {
    id: 'S19-realtime-phase-gates',
    title: 'D8 realtime จริงบน production มาวน์ท: SUBSCRIBED→live, ข้อผิดพลาด/ тайมเอาต์/ปิด→polling (ไม่โกหกว่า live); marker ถูกกติกา hidden/offline ปิด, กลับมา visible/online แล้ว refetch ต่อ',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      await page.goto(`${BASE}:${port}/fixture/inbox`);
      await configure(page, baseRoutes());
      await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
      const listCount = () => routeCount(page, '^/api/chat/inbox', 'GET');

      // Honest phase semantics: no live claim before the channel confirms.
      const connectingClass = await page.locator('.inbox-live').getAttribute('class');
      check((connectingClass || '').includes('inbox-live-connecting'), 'ก่อนสถานะใดๆ ต้องประกาศ connecting ไม่ใช่ live', connectingClass);

      const startCount = await listCount();
      await page.evaluate(() => { window.__supabaseFixture.channel('staff:staff-fixture-a:inbox').setStatus('SUBSCRIBED'); });
      // SUBSCRIBED fires one immediate trigger (visible + online by default).
      await page.waitForFunction(start => (window.__shim.routeCounts().find(route => route.method === 'GET' && route.pattern === '^/api/chat/inbox') || {count: start}).count >= start + 1, startCount, {timeout: 8000, polling: 30});
      const liveClass = await page.locator('.inbox-live').getAttribute('class');
      check((liveClass || '').includes('inbox-live-live'), 'SUBSCRIBED ประกาศ live และ trigger refetch ทันที', {class: liveClass, startCount});

      // HIDDEN document: the invalidate marker fails the gate — no refetch.
      const beforeHidden = await listCount();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
      });
      await page.evaluate(() => { window.__supabaseFixture.channel('staff:staff-fixture-a:inbox').fireInvalidate(); });
      await page.waitForTimeout(700);
      const hiddenCount = await listCount();
      check(hiddenCount === beforeHidden, 'ซ่อนหน้าจอ: invalidate marker ต้องไม่ยิง refetch (marker ไม่มี payload)', {beforeHidden, hiddenCount});

      // Back visible + the visibilitychange event: the gate reopens honestly.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(earlier => (window.__shim.routeCounts().find(route => route.method === 'GET' && route.pattern === '^/api/chat/inbox') || {count: earlier}).count > earlier, hiddenCount, {timeout: 8000, polling: 30});

      // OFFLINE: marker suppressed again (the visible timer passes through the same gate).
      const beforeOffline = await listCount();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => false});
      });
      await page.evaluate(() => { window.__supabaseFixture.channel('staff:staff-fixture-a:inbox').fireInvalidate(); });
      await page.waitForTimeout(700);
      const offlineCount = await listCount();
      check(offlineCount === beforeOffline, 'ออฟไลน์: invalidate marker ต้องไม่ยิง refetch', {beforeOffline, offlineCount});

      // Back online: the marker fires again.
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => true});
      });
      await page.evaluate(() => { window.__supabaseFixture.channel('staff:staff-fixture-a:inbox').fireInvalidate(); });
      await page.waitForFunction(earlier => (window.__shim.routeCounts().find(route => route.method === 'GET' && route.pattern === '^/api/chat/inbox') || {count: earlier}).count > earlier, offlineCount, {timeout: 8000, polling: 30});

      // Error/timeout/closed statuses never announce live — the UI falls back
      // to polling openly instead of claiming a live connection it lacks.
      for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
        await page.evaluate(name => { window.__supabaseFixture.channel('staff:staff-fixture-a:inbox').setStatus(name); }, status);
        const errorClass = await page.locator('.inbox-live').getAttribute('class');
        check((errorClass || '').includes('inbox-live-polling') && !(errorClass || '').includes('inbox-live-live'), `${status} → polling (ไม่ประกาศ live)`, errorClass);
      }
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Scenario S20 — incident batch selection + reviewed preview (OP06-13)     */
  /* ---------------------------------------------------------------------- */

  const incidentId = '33333333-3333-4333-8333-333333333333';
  const uOwnA = 'f1111111-1111-4111-8111-111111111111';
  const uOwnB = 'f2222222-2222-4222-8222-222222222222';
  const uInter = 'f4444444-4444-4444-8444-444444444444';
  const uOther = 'f5555555-5555-4555-8555-555555555555';
  const uUnassigned = 'f6666666-6666-4666-8666-666666666666';
  const uLate = 'f7777777-7777-4777-8777-777777777777';
  const uBatch = 'f8888888-8888-4888-8888-888888888888';

  function incidentCase(id, code, name) { return {ticketId: id, ticketCode: code, reporterLabel: name}; }
  const caseA = incidentCase(uOwnA, 'TK-1001 (fixture)', 'ผู้ใช้ N001 (fixture)');
  const caseB = incidentCase(uOwnB, 'TK-1002 (fixture)', 'ผู้ใช้ N002 (fixture)');
  const caseD = incidentCase(uInter, 'TK-4004 (fixture)', 'ผู้ใช้ N004 (fixture)');
  const caseE = incidentCase(uOther, 'TK-2005 (fixture)', 'ผู้ใช้ N005 (fixture)');
  const caseF = incidentCase(uUnassigned, 'TK-9006 (fixture)', 'ผู้ใช้ N006 (fixture)');
  const caseL = incidentCase(uLate, 'TK-1009 (fixture)', 'ผู้ใช้ N009 (fixture)');

  function incidentOption(item, eligibility, pending = 0) {
    return {...item, status: 'STAFF_HANDLING', eligibility, pendingUserMessages: pending};
  }

  function incidentOptions(items, revision = 3) {
    return {
      incidentId, incidentRevision: revision, incidentStatus: 'INVESTIGATING', canIntervene: true,
      workload: {memberCases: items.length + 1, activeCases: items.length, anonymousSessions: 3,
        activeAnonymousSessions: 2, unassignedCases: 1, assignedStaff: 2, pendingUserMessages: 7},
      items,
    };
  }

  function incidentPacket(recipientCode, rows, commonText) {
    return {recipientCode, cases: rows, messages: [
      {type: 'text', text: `อัปเดตเคส: ${rows.map(item => item.ticketCode).join(', ')}\n\n${commonText}`},
    ]};
  }

  function reviewedPreview(requestId, packets, rows, commonText, intervention) {
    return {
      status: 'REVIEW_ONLY', incidentId, requestId, cases: rows, caseCount: rows.length,
      recipientCount: packets.length, commonText, deliveries: packets, intervention,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      previewReceipt: `ORP-FIXTURE-RECEIPT-${requestId.slice(0, 8)}`,
    };
  }

  const S20 = {
    id: 'S20-incident-batch-select-review',
    title: 'OP06-13: ผู้ใช้เลือกเคสรายเคสตามสิทธิ์เอง (แนวหมวดไม่บิดเป็นเหตุการณ์เดียว) เพดาน 100, สิทธิ์เข้าแทรกแซงต้องยืนยัน, ตัวอย่างคือ snapshot จริงก่อนยืนยัน, แก้ข้อความแล้วตัวอย่างถูกยกเลิก, เคสเข้าทีหลังไม่ถูกใส่รายการที่ตรวจแล้ว',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      await page.goto(`${BASE}:${port}/fixture/incident-batch`);
      await configure(page, [
        {pattern: `^/api/incidents/${incidentId}/reply-options$`, method: 'GET', mode: 'scripted',
          queue: [{status: 200, body: json(incidentOptions([
            incidentOption(caseA, 'OWN_CASE', 2), incidentOption(caseB, 'OWN_CASE'),
            incidentOption(caseD, 'INTERVENTION_REQUIRED', 3), incidentOption(caseE, 'OTHER_ASSIGNEE'),
            incidentOption(caseF, 'UNASSIGNED'),
          ]))},
           {status: 200, body: json(incidentOptions([
            incidentOption(caseA, 'OWN_CASE', 2), incidentOption(caseB, 'OWN_CASE'),
            incidentOption(caseD, 'INTERVENTION_REQUIRED', 3), incidentOption(caseE, 'OTHER_ASSIGNEE'),
            incidentOption(caseF, 'UNASSIGNED'), incidentOption(caseL, 'OWN_CASE'),
           ], 4))},
           {status: 200, body: json(incidentOptions([
            incidentOption(caseA, 'OWN_CASE', 2), incidentOption(caseB, 'OWN_CASE'),
            incidentOption(caseD, 'INTERVENTION_REQUIRED', 3), incidentOption(caseE, 'OTHER_ASSIGNEE'),
            incidentOption(caseF, 'UNASSIGNED'), incidentOption(caseL, 'OWN_CASE'),
           ], 4))},
           {status: 200, body: json(incidentOptions([
            incidentOption(caseA, 'OWN_CASE', 2), incidentOption(caseB, 'OWN_CASE'),
            incidentOption(caseD, 'INTERVENTION_REQUIRED', 3), incidentOption(caseE, 'OTHER_ASSIGNEE'),
            incidentOption(caseF, 'UNASSIGNED'), incidentOption(caseL, 'OWN_CASE'),
           ], 4))}]},
        {pattern: 'replies/preview$', method: 'POST', mode: 'defer', key: 'batch-preview'},
        {pattern: `^/api/incidents/${incidentId}/replies$`, method: 'GET', mode: 'respond', status: 200, body: json({batches: []})},
      ]);
      await page.waitForFunction(() => document.querySelectorAll('.incident-batch-case-list li').length === 5, null, {timeout: 8000, polling: 30});

      const countsText = await page.locator('.incident-batch-counts').innerText();
      check(countsText.includes('เคสที่เชื่อมโยง') && countsText.includes('ข้อความจากผู้ใช้ที่รอตอบ'), 'จำนวนเคส/ผู้รับบนหน้าคือข้อมูลจริงจากรายการ options (ไม่เดา)', countsText);
      const guidance = await page.locator('.incident-batch-selection-guidance').innerText();
      check(guidance.includes('หมวดเดียวกันไม่ได้แปลว่าเป็นเหตุการณ์เดียวกัน'), 'ข้อความกันการสรุปว่าหมวดเดียว = ผู้รายงานเดียว', guidance);
      const otherDisabled = await page.locator('.incident-batch-case-list li').nth(3).locator('input').isDisabled();
      check(otherDisabled, 'เคสที่มอบหมายให้คนอื่นไม่เลือกได้', null);
      const unassignedDisabled = await page.locator('.incident-batch-case-list li').nth(4).locator('input').isDisabled();
      check(unassignedDisabled, 'เคสที่ยังไม่มีผู้รับผิดชอบไม่เลือกได้', null);

      await page.locator('.incident-batch-case-list li').nth(0).locator('input').check();
      await page.locator('.incident-batch-case-list li').nth(1).locator('input').check();
      const counter = await page.locator('.incident-batch-actions > span').innerText();
      check(counter === '2 เคสที่เลือก', 'เลือกรายเคสตามสิทธิ์เอง พร้อมจำนวนเคสที่เลือกจริง', counter);
      const interventionWarnHidden = (await page.locator('.incident-batch-intervention').count()) > 0
        && (await page.locator('.incident-batch-intervention input').isEnabled());
      check(interventionWarnHidden, 'ช่องยืนยันการเข้าแทรกแซงพร้อมใช้ได้เมื่อมีเคสต้องแทรกแซง', null);

      await page.locator('.incident-batch-intervention input').check();
      const interEnabled = !(await page.locator('.incident-batch-case-list li').nth(2).locator('input').isDisabled());
      check(interEnabled, 'หลังยืนยันการเข้าแทรกแซง เคสที่ต้องแทรกแซงกลายเป็นที่เลือกได้', null);
      await page.locator('button:has-text("เลือกเคสที่เข้าเกณฑ์ทั้งหมดจากรายการปัจจุบัน (สูงสุด 100)")').click();
      const counterAfter = await page.locator('.incident-batch-actions > span').innerText();
      check(counterAfter === '3 เคสที่เลือก', 'เลือกทั้งหมดที่มีสิทธิ์ (สั้นสุดพอดีตาม options) + คงรายการที่เลือกก่อน', counterAfter);
      const interChecked = await page.locator('.incident-batch-case-list li').nth(2).locator('input').isChecked();
      check(interChecked, 'เคสแทรกแซงถูกเลือกผ่านทางยืนยันที่ชัดเจน', null);

      const text = 'ขอชะลอการเชื่อมรายละเอียดเพิ่มเติมภายในวันนี้ (fixture)';
      await page.locator(`#incident-batch-text-${incidentId}`).fill(text);
      await page.locator('button:has-text("ตรวจข้อความและผู้รับ")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && /replies\/preview$/.test(request.url)), null, {timeout: 8000, polling: 30});
      const [previewRequest] = await postRequests(page, 'replies/preview$');
      const previewBody = JSON.parse(previewRequest.body);
      check(previewBody.requestId.length === 36 && previewBody.text === text && previewBody.intervention === true,
        'คำขอ preview ส่ง requestId + ข้อความ + สถานะแทรกแซงตรงที่ผู้ใช้เลือก', previewBody);
      check(JSON.stringify([...previewBody.ticketIds].sort()) === JSON.stringify([uOwnA, uInter, uOwnB].sort()),
        'preview ส่งรายการเคสที่ผู้ใช้เลือกเองเท่านั้น', previewBody);
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-preview#1', answer), {
        status: 200, body: reviewedPreview(previewBody.requestId, [
          incidentPacket('R1', [caseA, caseB], previewBody.text),
          incidentPacket('R2', [caseD], previewBody.text),
        ], [caseA, caseB, caseD], previewBody.text, true),
      });
      await page.waitForFunction(() => document.body.innerText.includes('ตรวจรายการก่อนเข้าคิว'), null, {timeout: 8000, polling: 30});
      const reviewText = await page.locator('.incident-batch-review').innerText();
      check(reviewText.includes('3 เคส · 2 ช่องทางผู้รับนิรนามที่ไม่ซ้ำ') && reviewText.includes('การยืนยันรับเข้าคิว ไม่ได้ยืนยันการส่งหรือการอ่าน'),
        'ตัวอย่างเป็น snapshot จริงก่อนยืนยัน พร้อมคำเตือน QUEUED ไม่ใช่ SENT', reviewText);
      check(reviewText.includes('R1') && reviewText.includes('2 เคส') && reviewText.includes('R2') && reviewText.includes('1 เคส'),
        'ผู้รับถูกแบ่งแยกเป็นตัวตนนิรนามรายช่องทาง ไม่รวบคน', reviewText);

      await page.locator(`#incident-batch-text-${incidentId}`).fill('แก้ข้อความใหม่หลังเห็นตัวอย่าง (fixture)');
      await page.waitForFunction(() => document.body.innerText.includes('ตัวอย่างเดิมถูกยกเลิก'), null, {timeout: 8000, polling: 30});
      const reviewGone = (await page.locator('.incident-batch-review').count()) === 0;
      check(reviewGone, 'แก้ข้อความ/เคสบางอย่างหลังสร้างตัวอย่าง → ตัวอย่างถูกยกเลิก ต้องตรวจใหม่', null);
      const previewCount = await routeCount(page, 'replies/preview$', 'POST');
      check(previewCount === 1, 'ระบบไม่ออกตัวอย่างใหม่เงียบ ๆ ต้องกดตรวจเอง', previewCount);

      await page.locator('.incident-batch-refresh').click();
      await page.waitForFunction(() => document.querySelectorAll('.incident-batch-case-list li').length === 6, null, {timeout: 8000, polling: 30});
      const lateChecked = await page.locator('.incident-batch-case-list li').nth(5).locator('input').isChecked();
      check(lateChecked === false, 'เคสเข้าทีหลังแสดงในรายการใหม่แต่ไม่ถูกติ๊กเอง (ไม่เสียบใน batch ที่ตรวจแล้ว)', null);
      const counterLate = await page.locator('.incident-batch-actions > span').innerText();
      check(counterLate === '3 เคสที่เลือก', 'รายการที่ผู้ใช้เลือกเดิมคงอยู่หลังรีเฟรชรายการ', counterLate);
      const stillOnePreview = await routeCount(page, 'replies/preview$', 'POST');
      check(stillOnePreview === 1, 'หลังรีเฟรช ต้องสร้างตัวอย่างใหม่ก่อนยืนยันเสมอ', stillOnePreview);
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Scenario S21 — incident batch confirm/status/retry truth (OP06-14)      */
  /* ---------------------------------------------------------------------- */

  const S21 = {
    id: 'S21-incident-batch-confirm-status-retry',
    title: 'OP06-14: 409 บังคับทบทวนใหม่ (ล้าง snapshot ไม่ยัด decision ใหม่), 202 รับเข้าคิวไม่ใช่ส่งเสร็จ, ผลส่งรายผู้รับจริงและลองส่งใช้ requestId เดิมกับ batch เดิม',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      const batchStatusList = {
        batches: [{
          status: 'ACCEPTED', batchId: uBatch, acceptedAt: '2026-10-28T03:30:00.000Z',
          caseCount: 2, recipientCount: 2,
          recipients: [
            {recipientCode: 'R1', ticketCodes: ['TK-1001 (fixture)'], deliveryStatus: 'SENT', retryable: false},
            {recipientCode: 'R2', ticketCodes: ['TK-1002 (fixture)'], deliveryStatus: 'DEAD',
              retryable: true, safeFailureCode: 'TEMPORARY_FAILURE'},
          ],
        }],
      };
      const batchEmpty = {batches: []};
      await page.goto(`${BASE}:${port}/fixture/incident-batch`);
      await configure(page, [
        {pattern: `^/api/incidents/${incidentId}/reply-options$`, method: 'GET', mode: 'respond', status: 200,
          body: json(incidentOptions([
            incidentOption(caseA, 'OWN_CASE'), incidentOption(caseB, 'OWN_CASE'),
            incidentOption(caseD, 'INTERVENTION_REQUIRED'), incidentOption(caseE, 'OTHER_ASSIGNEE'),
            incidentOption(caseF, 'UNASSIGNED'),
          ]))},
        {pattern: `^/api/incidents/${incidentId}/replies$`, method: 'GET', mode: 'scripted',
          queue: [{status: 200, body: json(batchEmpty)}, {status: 200, body: json(batchEmpty)},
            {status: 200, body: json(batchStatusList)}, {status: 200, body: json(batchStatusList)},
            {status: 200, body: json(batchStatusList)}, {status: 200, body: json(batchStatusList)},
            {status: 200, body: json(batchStatusList)}]},
        {pattern: 'replies/preview$', method: 'POST', mode: 'defer', key: 'batch-preview'},
        {pattern: 'replies/confirm$', method: 'POST', mode: 'defer', key: 'batch-confirm'},
        {pattern: 'replies/.*/retry$', method: 'POST', mode: 'defer', key: 'batch-retry'},
      ]);
      await page.waitForFunction(() => document.querySelectorAll('.incident-batch-case-list li').length === 5, null, {timeout: 8000, polling: 30});

      // First reviewed batch → confirm answers 409: the response must Annex the
      // snapshot AND reset the reviewed selection, never silently re-decide.
      await page.locator('.incident-batch-case-list li').nth(0).locator('input').check();
      await page.locator('.incident-batch-case-list li').nth(1).locator('input').check();
      const text = 'ส่งทบทวนเวลาทำงานใหม่แก่ทุกเคสที่เลือก (fixture)';
      await page.locator(`#incident-batch-text-${incidentId}`).fill(text);
      await page.locator('button:has-text("ตรวจข้อความและผู้รับ")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && /replies\/preview$/.test(request.url)), null, {timeout: 8000, polling: 30});
      const [firstPreview] = await postRequests(page, 'replies/preview$');
      const firstBody = JSON.parse(firstPreview.body);
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-preview#1', answer), {
        status: 200, body: reviewedPreview(firstBody.requestId, [
          incidentPacket('R1', [caseA, caseB], firstBody.text),
        ], [caseA, caseB], firstBody.text, false),
      });
      await page.waitForFunction(() => document.body.innerText.includes('ตรวจรายการก่อนเข้าคิว'), null, {timeout: 8000, polling: 30});
      await page.locator('button:has-text("ยืนยันและเข้าคิวส่งข้อความ")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && /replies\/confirm$/.test(request.url)), null, {timeout: 8000, polling: 30});
      const [firstConfirm] = await postRequests(page, 'replies/confirm$');
      check(JSON.parse(firstConfirm.body).previewReceipt.includes('ORP-FIXTURE-RECEIPT'), 'ยืนยันส่งใบตัวอย่างเดิม (จากไฟล์เสนอแบบ skill snapshot)', firstConfirm.body);
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-confirm#1', answer), {status: 409, body: {error: 'CONFLICT'}});
      await page.waitForFunction(() => document.body.innerText.includes('ข้อมูลหรือสิทธิ์เปลี่ยนก่อนเข้าคิว'), null, {timeout: 8000, polling: 30});
      const recoveryAfter409 = (await page.locator('.incident-batch-recovery').count()) === 0;
      check(recoveryAfter409, '409 ล้างใบยืนยันเดิมออกจาก recovery จริง', null);
      const counterAfter409 = await page.locator('.incident-batch-actions > span').innerText();
      check(counterAfter409 === '0 เคสที่เลือก', '409 บังคับรีเลือกเคสเพื่อทบทวน ไม่ออกเข้าคิวเงียบ', counterAfter409);
      const keptText = await page.locator(`#incident-batch-text-${incidentId}`).inputValue();
      check(keptText === text, 'ข้อความยังอยู่หลัง 409', keptText);
      const emptyStatuses = (await page.locator('.incident-batch-results').count()) > 0
        && (await page.locator('.incident-batch-results').innerText()).includes('ยังไม่มีข้อความที่รับเข้าคิว');
      check(emptyStatuses, 'ผลตอบกลับยังว่างอย่างตรงไปตรงมา (ไม่มี batch ถูกสร้าง)', null);

      // Second review succeeded: 202 means QUEUED, never delivered.
      await page.locator('.incident-batch-case-list li').nth(0).locator('input').check();
      await page.locator('button:has-text("ตรวจข้อความและผู้รับ")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().filter(request => request.method === 'POST' && /replies\/preview$/.test(request.url)).length === 2, null, {timeout: 8000, polling: 30});
      const [, secondPreview] = await postRequests(page, 'replies/preview$');
      const secondBody = JSON.parse(secondPreview.body);
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-preview#2', answer), {
        status: 200, body: reviewedPreview(secondBody.requestId, [
          incidentPacket('R1', [caseA], secondBody.text),
        ], [caseA], secondBody.text, false),
      });
      await page.waitForFunction(() => document.body.innerText.includes('ตรวจรายการก่อนเข้าคิว'), null, {timeout: 8000, polling: 30});
      await page.locator('button:has-text("ยืนยันและเข้าคิวส่งข้อความ")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().filter(request => request.method === 'POST' && /replies\/confirm$/.test(request.url)).length === 2, null, {timeout: 8000, polling: 30});
      await postRequests(page, 'replies/confirm$');
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-confirm#2', answer), {
        status: 202, body: {status: 'ACCEPTED', batchId: uBatch, incidentId, requestId: secondBody.requestId,
          caseCount: 1, recipientCount: 1, createdAt: '2026-10-28T03:40:00.000Z', replayed: false},
      });
      await page.waitForFunction(() => document.body.innerText.includes('รับเข้าคิวแล้ว · 1 เคส · 1 ช่องทางผู้รับนิรนามที่ไม่ซ้ำ'), null, {timeout: 8000, polling: 30});
      const successText = await page.locator('.incident-batch-success').first().innerText();
      check(successText.includes('ยังไม่ยืนยันผลการส่งหรือการอ่าน'), '202/รับเข้าคิว ต้องไม่อ้างว่าส่งเสร็จหรือถูกอ่าน', successText);

      // Per-recipient truth + retry only where the Server marks the lane retryable.
      await page.waitForFunction(() => document.querySelectorAll('.incident-batch-recipient-list li').length === 2, null, {timeout: 8000, polling: 30});
      const resultsText = await page.locator('.incident-batch-results').innerText();
      check(resultsText.includes('รับเข้าคิวแล้ว') && resultsText.includes('R1') && resultsText.includes('R2'),
        'ผลออกรายช่องทางผู้รับส่วนตัว (partial truth)', resultsText);
      const sentHelps = await page.locator('p:has-text("LINE รับข้อความแล้ว · ไม่ใช่หลักฐานว่าเปิดอ่านแล้ว")').count();
      check(sentHelps === 1, 'SENT ระบุชัดว่าไม่ใช่การยืนยันการอ่าน', sentHelps);
      const deadLabel = await page.locator('.incident-batch-delivery-dead').first().innerText();
      check(deadLabel === 'ส่งไม่สำเร็จ', 'ผู้รับกรณีส่งไม่สำเร็จแสดงหลักฐานผลลัพธ์จริง', deadLabel);
      const failureLabel = await page.locator('.incident-batch-failure').first().innerText();
      check(failureLabel === 'ระบบปลายทางขัดข้องชั่วคราว', 'รหัสความล้มเหลวแปลเป็นคำที่ไม่เปิดเผยข้อมูลปลายทาง', failureLabel);
      const retryButtons = await page.locator('button:has-text("ลองส่งผู้รับนี้อีกครั้ง")').count();
      check(retryButtons === 1, 'ลองส่งได้เฉพาะผู้รับที่ server มารกว่า retryable', retryButtons);

      await page.locator('button:has-text("ลองส่งผู้รับนี้อีกครั้ง")').click();
      await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && /replies\/.*\/retry$/.test(request.url)), null, {timeout: 8000, polling: 30});
      const [retryRequest] = await postRequests(page, 'replies/.*\/retry$');
      const retryBody = JSON.parse(retryRequest.body);
      check(retryRequest.url.includes(`/replies/${uBatch}/retry`) && retryBody.requestId.length === 36
        && JSON.stringify(retryBody.recipientCodes) === JSON.stringify(['R2']),
        'ลองส่งใช้ batch เดิม + รหัสผู้รับเดิม + requestId ใหม่ที่ระบบเก็บไว้', retryRequest);
      await page.evaluate(answer => window.__shim.resolveDeferred('batch-retry#1', answer), {
        status: 202, body: {status: 'RETRY_ACCEPTED', batchId: uBatch, requestId: retryBody.requestId,
          recipientCodes: ['R2'], replayed: false},
      });
      await page.waitForFunction(() => document.body.innerText.includes('รับคำขอลองส่งเข้าคิวแล้ว'), null, {timeout: 8000, polling: 30});
      const afterRetry = (await page.locator('.incident-batch-results').innerText());
      check(afterRetry.includes('รับคำขอลองส่งเข้าคิวแล้ว · ยังไม่ยืนยันผลการส่ง'), 'ผลลองส่งก็ยังไม่อ้างว่าส่งเสร็จ', afterRetry);
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Scenario S22 — onboarding login availability (OP06-11)                  */
  /* ---------------------------------------------------------------------- */

  function applyContextFixture(overrides = {}) {
    return {
      authenticated: true, lineLinked: true, staffActive: false, loginAvailable: true, canReview: false,
      application: null,
      departments: [{id: '44444444-4444-4444-8444-444444444444', name: 'งานทะเบียนสถานศึกษา (fixture)'}],
      ...overrides,
    };
  }

  const S22 = {
    id: 'S22-onboarding-login-availability',
    title: 'OP06-11: 401 fallback ยังมีสองทางเข้าจริง แต่ loginAvailable:false ห้ามขายปุ่ม LINE (ไม่ fake OAuth) และให้คำ copy ที่จริงใจแทน',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      await page.goto(`${BASE}:${port}/fixture/apply`);
      await configure(page, [
        {pattern: '^/api/staff/onboarding$', method: 'GET', mode: 'respond', status: 401, body: json({error: 'unauthenticated'})},
      ]);
      await page.waitForFunction(() => document.body.innerText.includes('ต้องเข้าสู่ระบบก่อนยื่นคำขอ'), null, {timeout: 8000, polling: 30});
      const lineUrls401 = await page.locator('a[href="/auth/line?next=/staff/apply"]').count();
      const staffLinks401 = await page.locator('a[href="/login"]').count();
      check(lineUrls401 === 1 && staffLinks401 >= 1, '401 fallback (ไม่รู้บริบท) คงสองทางเข้าจริง', {lineUrls401, staffLinks401});

      await page.reload();
      await configure(page, [
        {pattern: '^/api/staff/onboarding$', method: 'GET', mode: 'respond', status: 200,
          body: json(applyContextFixture({authenticated: false, loginAvailable: false}))},
      ]);
      await page.waitForFunction(() => document.body.innerText.includes('ยังเข้าสู่ระบบด้วย LINE เพื่อสมัครไม่ได้'), null, {timeout: 8000, polling: 30});
      const lineUrlsUnavailable = await page.locator('a[href^="/auth/line"]').count();
      check(lineUrlsUnavailable === 0, 'context 200 แจ้งว่า LINE ยังไม่ตั้งค่า → ห้ามมีปุ่ม OAuth', lineUrlsUnavailable);
      const staffLinkUnavailable = await page.locator('a[href="/login"]').count();
      check(staffLinkUnavailable >= 1, 'อนุญาตเฉพาะทางกลับบัญชีบุคลากร', staffLinkUnavailable);
      const unavailableCopy = await page.locator('.staff-onboard-lead').innerText();
      check(unavailableCopy.includes('ยังไม่เปิดใช้การเข้าสู่ระบบด้วย LINE'), 'คำอธิบายความจริงแสดงแทนการปลอมปุ่ม login', unavailableCopy);
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Scenario S23 — onboarding approved-inactive gate (OP06-11)              */
  /* ---------------------------------------------------------------------- */

  const S23 = {
    id: 'S23-onboarding-approved-inactive',
    title: 'OP06-11: คำขอ APPROVED แต่บัญชียังไม่เปิดใช้ → สถานะ unavailable แบบทั่วไปพร้อมเหตุผลจริง ไม่เปิดฟอร์มให้ยื่นซ้ำ',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      await page.goto(`${BASE}:${port}/fixture/apply`);
      await configure(page, [
        {pattern: '^/api/staff/onboarding$', method: 'GET', mode: 'respond', status: 200,
          body: json(applyContextFixture({application: {
            id: '99999999-9999-4999-8999-999999999991', applicantName: 'ผู้สมัครอนุมัติแต่ไม่ได้เปิดใช้ (fixture)',
            staffCode: 'STFF-9091', requestedDepartmentId: '44444444-4444-4444-8444-444444444444',
            requestedDepartmentName: 'งานทะเบียนสถานศึกษา (fixture)', approvedDepartmentId: null,
            approvedDepartmentName: null, status: 'APPROVED', revision: 1,
            submittedAt: '2026-10-25T09:00:00.000Z', reviewedAt: '2026-10-26T09:00:00.000Z',
            reviewerName: 'ผู้ดูแล Fixtures', decisionReason: 'อนุมัติแต่บัญชียังไม่เปิดใช้ (fixture)',
          }}))},
      ]);
      await page.waitForFunction(() => document.body.innerText.includes('ไม่สามารถเปิดหน้าสมัครได้ในขณะนี้'), null, {timeout: 8000, polling: 30});
      const formGone = (await page.locator('#staff-onboard-name').count()) === 0;
      check(formGone, 'APPROVED+ยังไม่เปิดใช้ ต้องไม่เปิดฟอร์มยื่นซ้ำ', null);
      const notice = await page.locator('.staff-onboard-lead').innerText();
      check(notice.includes('บัญชีบุคลากรของคุณยังไม่พร้อมใช้งาน') && notice.includes('โปรดให้ผู้ดูแลระบบตรวจสอบการอนุมัติของคุณ'),
        'reason ของ unavailable บอกว่ารอผู้ดูแลตรวจสอบ (ไม่ auto-activate)', notice);
      const submitButton = await page.locator('button[type="submit"]').count();
      check(submitButton === 0, 'ไม่มีปุ่มยื่นคำขอในสถานะนี้', submitButton);
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Scenario S24 — onboarding REJECTED recorded terminal (OP06-11)          */
  /* ---------------------------------------------------------------------- */

  const S24 = {
    id: 'S24-onboarding-rejected-terminal',
    title: 'OP06-11: คำขอ REJECTED แสดงสถานะสุดท้ายจริง — reviewer + เหตุผลจากบันทึกจริงเท่านั้น, ไม่มีฟอร์มยื่นซ้ำ',
    viewport: {width: 1440, height: 900},
    async run(page, port, check) {
      await page.goto(`${BASE}:${port}/fixture/apply`);
      await configure(page, [
        {pattern: '^/api/staff/onboarding$', method: 'GET', mode: 'respond', status: 200,
          body: json(applyContextFixture({application: {
            id: '99999999-9999-4999-8999-999999999992', applicantName: 'ผู้สมัครไม่ผ่าน (fixture)',
            staffCode: 'STFF-9092', requestedDepartmentId: '44444444-4444-4444-8444-444444444444',
            requestedDepartmentName: 'งานทะเบียนสถานศึกษา (fixture)', approvedDepartmentId: null,
            approvedDepartmentName: null, status: 'REJECTED', revision: 2,
            submittedAt: '2026-10-25T09:00:00.000Z', reviewedAt: '2026-10-26T09:00:00.000Z',
            reviewerName: 'ผู้ดูแล Fixtures', decisionReason: 'ตรวจสอบรหัสบุคลากรไม่เจอข้อมูล (fixture)',
          }}))},
      ]);
      await page.waitForFunction(() => document.body.innerText.includes('คำขอของคุณอยู่ในระบบแล้ว'), null, {timeout: 8000, polling: 30});
      const chip = await page.locator('.staff-onboard-chip').innerText();
      check(chip === 'ไม่อนุมัติ', 'REJECTED แสดง chip สถานะเดิมตามบันทึกเสนอจริง', chip);
      const details = await page.locator('.staff-onboard-definition').innerText();
      check(details.includes('ผู้พิจารณา') && details.includes('ผู้ดูแล Fixtures')
        && details.includes('เหตุผลที่บันทึก') && details.includes('ตรวจสอบรหัสบุคลากรไม่เจอข้อมูล (fixture)'),
        'ผู้พิจารณา/เหตุผลมาจากเรคคอร์ดจริงเท่านั้น', details);
      check(details.includes('ไม่สามารถยื่นซ้ำได้ในช่วงนี้') && details.includes('จะไม่ถูกเปิดใช้งานอัตโนมัติ'),
        'ขั้นตอนสุดท้ายของ REJECTED บอกชัดว่าไม่ยื่นซ้ำ ไม่ auto-activate', details);
      const formGone = (await page.locator('#staff-onboard-name').count()) === 0;
      check(formGone, 'แถวบันทึกสุดท้ายผูก inline ฟอร์มในหน้าไม่ให้แอบยื่นซ้ำ', formGone);
    },
  };

/* ---------------------------------------------------------------------- */
/* Scenario S25 — OC07 P2 / RX4: sparse non-1 sequences & 51-item history  */
/* ---------------------------------------------------------------------- */

const S25 = {
  id: 'S25-rx4-sparse-sequences-and-history',
  title: 'OC07 RX4: เลขข้อความไม่ต่อกันและไม่เริ่มที่ 1 (5/9/12, hasMore:false) ACK throughSequence=12 จริง; 51 ข้อความ sparse (hasMore:true) hold ก่อนโหลดเก่าแล้ว ACK หลังโหลดครบ',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    const sparseLatest = Array.from({length: 50}, (_, index) => 20 + index * 3); // [20, 23, ..., 167]
    const sparseTail = sparseLatest[sparseLatest.length - 1]; // 167
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      // Room A: sparse non-1, hasMore:false ([5, 9, 12], cursor 0) -> must ACK 12.
      {pattern: `^/api/chat/tickets/${uuidA}`, method: 'GET', mode: 'respond', status: 200,
        body: json(threadFor(ticketItem(uuidA, 1, 'sparse 5/9/12 กรณี A', 3, 'WAITING_STAFF', 'AI'), {
          sequences: [5, 9, 12], hasMore: false, nextBefore: null, readThrough: 0,
        }))},
      // Room B: 51-item sparse non-1 ticket ([5] older + [20, 23, ..., 167] newest).
      {pattern: `^/api/chat/tickets/${uuidB}\\?beforeSequence=20`, method: 'GET', mode: 'respond', status: 200,
        body: json(threadFor(ticketItem(uuidB, 2, 'sparse 51 รายการ กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {
          sequences: [5], hasMore: false, nextBefore: null, readThrough: 0,
        }))},
      {pattern: `^/api/chat/tickets/${uuidB}`, method: 'GET', mode: 'respond', status: 200,
        body: json(threadFor(ticketItem(uuidB, 2, 'sparse 51 รายการ กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {
          sequences: sparseLatest, hasMore: true, nextBefore: 20, readThrough: 0,
        }))},
      {pattern: `^/api/chat/tickets/${uuidA}.*/read$`, method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 12})},
      {pattern: `^/api/chat/tickets/${uuidB}.*/read$`, method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: sparseTail})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});

    // Part 1: Room A (5/9/12, hasMore:false, readThrough:0) -> POST /read { throughSequence: 12 }.
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length === 3, null, {timeout: 8000, polling: 30});
    await page.waitForFunction(id => window.__shim.requestsSnapshot().some(r => r.method === 'POST' && r.url.includes(id) && r.url.includes('/read')), uuidA, {timeout: 3000, polling: 30}).catch(() => null);
    await waitForCommitBarrier(page);
    const readsA = await postRequests(page, `${uuidA}/read$`);
    check(readsA.length >= 1, 'ห้อง A (5/9/12, hasMore:false) ต้องส่ง POST /read หลัง React commit', readsA);
    const seqA = readsA.length ? JSON.parse(readsA[0].body).throughSequence : null;
    check(seqA === 12 && [5, 9, 12].includes(seqA), 'throughSequence ของห้อง A ต้องเท่ากับ 12 (sequence จริงสุดท้าย)', {readsA, seqA});

    // Part 2: Room B (50 sparse items [20..167], hasMore:true) -> even when
    // scrolled to the bottom tail sentinel, hold ACK before history load.
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length === 50, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    await page.evaluate(() => {
      const pane = document.querySelector('.inbox-message-scroll');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await waitForCommitBarrier(page);
    const readsBBefore = await postRequests(page, `${uuidB}/read$`);
    check(readsBBefore.length === 0, 'หน้าต่างแรกของ B (50 จาก 51 รายการ, hasMore:true) ห้ามส่ง POST /read ข้ามประวัติที่ยังไม่โหลด', readsBBefore);

    // Load older history (beforeSequence=20 -> [5], hasMore:false) -> [6..19] and [1..4] proven empty -> scroll to tail and ACK sparseTail (167).
    await page.locator('button:has-text("โหลดข้อความก่อนหน้า")').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length === 51, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    await page.evaluate(() => {
      const pane = document.querySelector('.inbox-message-scroll');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await waitForCommitBarrier(page);
    const gapButtonsAfter = await page.locator('.inbox-gap-control').count();
    check(gapButtonsAfter === 0, 'หลังโหลดข้อความ 5 (beforeSequence=20, hasMore:false) ต้องไม่ค้างปุ่ม gap-control ที่ไม่มีจริง', gapButtonsAfter);
    await page.waitForFunction(id => window.__shim.requestsSnapshot().some(r => r.method === 'POST' && r.url.includes(id) && r.url.includes('/read')), uuidB, {timeout: 3500, polling: 30}).catch(() => null);
    await waitForCommitBarrier(page);
    const readsBAfter = await postRequests(page, `${uuidB}/read$`);
    check(readsBAfter.length >= 1, 'หลังโหลดข้อความก่อนหน้า (hasMore:false) ห้อง B ต้องส่ง POST /read จริง', readsBAfter);
    const seqB = readsBAfter.length ? JSON.parse(readsBAfter[0].body).throughSequence : null;
    check(seqB === sparseTail && sparseLatest.includes(seqB), `throughSequence ของห้อง B ต้องเป็น sequence จริงสุดท้าย (${sparseTail})`, {readsBAfter, seqB, sparseTail});
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S26 — OC07 P3: 401 triggers immediate whole-actor reset       */
/* ---------------------------------------------------------------------- */

const S26 = {
  id: 'S26-401-immediate-actor-reset',
  title: 'OC07 P3: 401 จาก thread ต้อง reset ทั้ง actor ทันทีแม้ list request ยังค้าง — กด B ห้ามเผย cache/ร่างของ B',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    // Populate cache for A, then cache + private draft for B.
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await clickRow(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await page.locator('#chat-reply').fill('PRIVATE_DRAFT_B_401');

    // Configure: list hangs (defer), A returns 401, B defers fresh GET.
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'defer', key: 'list-hang'},
      {pattern: `^/api/chat/tickets/${uuidA}`, method: 'GET', mode: 'respond', status: 401, body: json({error: 'UNAUTHENTICATED'})},
      {pattern: `^/api/chat/tickets/${uuidB}`, method: 'GET', mode: 'defer', key: 'get-b-401'},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 11})},
    ]);
    await clickRow(page, 0);
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('list-hang')), null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);

    const rowsWhileListHangs = await page.locator('.inbox-ticket-row').count();
    check(rowsWhileListHangs === 0, 'หลัง A ได้ 401 list ต้องถูกล้างทันทีโดยไม่ต้องรอ list request ที่ค้างตอบ 401', rowsWhileListHangs);
    if (rowsWhileListHangs >= 2) {
      // On unpatched HEAD rows remain visible while list hangs: clicking B proves cache/draft leak!
      await clickRow(page, 1);
      await waitForCommitBarrier(page);
    }
    const leakWhileListHangs = await page.evaluate(() => ({
      messageCount: document.querySelectorAll('.inbox-message').length,
      notePanelPresent: document.querySelector('.inbox-note-disclosure') !== null,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(leakWhileListHangs.messageCount === 0, 'ระหว่าง list ค้างหลัง 401 ห้ามเผยข้อความเก่าของ B ก่อน GET ใหม่', leakWhileListHangs);
    check(leakWhileListHangs.draftValue === '' || leakWhileListHangs.draftValue === null, 'ระหว่าง list ค้างหลัง 401 ร่างของ B ต้องถูกล้างแล้ว (ห้ามโผล่)', leakWhileListHangs);

    // Also verify if list recovers 200 later while GET B still hangs: B has NO cached record or draft.
    await page.evaluate(body => window.__shim.resolveDeferred('list-hang#1', {status: 200, body}), LIST_BODY);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 1);
    await page.waitForFunction(() => window.__shim.deferredKeys().some(key => key.startsWith('get-b-401')), null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);
    const afterRecoverBeforeGetB = await page.evaluate(() => ({
      messageCount: document.querySelectorAll('.inbox-message').length,
      notePanelPresent: document.querySelector('.inbox-note-disclosure') !== null,
      draftValue: (document.querySelector('#chat-reply') || {}).value ?? null,
    }));
    check(afterRecoverBeforeGetB.messageCount === 0 && !afterRecoverBeforeGetB.notePanelPresent, 'หลัง 401 แม้ list ฟื้น 200 ก่อน GET B ยืนยันต้องไม่เหลือ cache ของ B', afterRecoverBeforeGetB);
    check(afterRecoverBeforeGetB.draftValue === '' || afterRecoverBeforeGetB.draftValue === null, 'หลัง 401 ร่างของ B ต้องถูก whole-actor reset ลบถาวร', afterRecoverBeforeGetB);

    await page.evaluate(body => window.__shim.resolveDeferred('get-b-401#1', {status: 200, body}),
      json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {sequences: [4, 7, 11], readThrough: 0})));
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length === 3, null, {timeout: 8000, polling: 30});
  },
};

/* ---------------------------------------------------------------------- */
/* Scenario S27 — OC07 P3: stale-epoch read-ack 403 must not close room   */
/* ---------------------------------------------------------------------- */

const S27 = {
  id: 'S27-stale-epoch-read-ack-403',
  title: 'OC07 P3: read-ack 403 จาก epoch เก่าต้องไม่ลบหรือปิดห้อง A ที่ได้รับอนุญาตใหม่ใน epoch ใหม่แล้ว',
  viewport: {width: 1440, height: 900},
  async run(page, port, check) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: `^/api/chat/tickets/${uuidA}`, method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'ไม่สามารถลงทะเบียน กรณี A', 3, 'WAITING_STAFF', 'AI'), {messages: 3, seqFrom: 1, readThrough: 0}))},
      {pattern: `^/api/chat/tickets/${uuidB}`, method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidB, 2, 'ปัญหาการชำระเงิน กรณี B', 5, 'STAFF_HANDLING', 'HUMAN'), {sequences: [4, 7, 11], readThrough: 0}))},
      {pattern: `^/api/chat/tickets/${uuidA}.*/read$`, method: 'POST', mode: 'defer', key: 'read-a'},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});

    // Epoch 0: open A, read-a#1 hangs in-flight.
    await clickRow(page, 0);
    await page.waitForFunction(() => window.__shim.deferredKeys().includes('read-a#1'), null, {timeout: 8000, polling: 30});

    // List denial 403 bumps actor epoch (epoch -> 1) and clears selection.
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 403, body: json({error: 'FORBIDDEN'})},
    ]);
    await page.locator('.inbox-icon-button[aria-label="โหลดรายการใหม่"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 0, null, {timeout: 8000, polling: 30});

    // Recover list 200 and re-open fresh A 200 in new epoch.
    await configure(page, [
      {pattern: '^/api/chat/inbox', method: 'GET', mode: 'respond', status: 200, body: LIST_BODY},
      {pattern: `^/api/chat/tickets/${uuidA}`, method: 'GET', mode: 'respond', status: 200, body: json(threadFor(ticketItem(uuidA, 1, 'กรณี A หลัง re-auth', 4, 'WAITING_STAFF', 'AI'), {messages: 3, seqFrom: 1, readThrough: 0}))},
      {pattern: `^/api/chat/tickets/${uuidA}.*/read$`, method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 11})},
    ]);
    await page.locator('.inbox-icon-button[aria-label="โหลดรายการใหม่"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);

    const staleStillDeferred = await page.evaluate(() => window.__shim.deferredKeys().includes('read-a#1'));
    check(staleStillDeferred, 'POST A/read จาก epoch เก่ายังค้างขณะเปิด A ใหม่สำเร็จ', staleStillDeferred);

    // Now the stale-epoch POST A/read finally returns 403!
    await page.evaluate(() => window.__shim.resolveDeferred('read-a#1', {status: 403, body: JSON.stringify({error: 'FORBIDDEN'})}));
    await page.waitForFunction(() => !window.__shim.deferredKeys().includes('read-a#1'), null, {timeout: 8000, polling: 30});
    await waitForCommitBarrier(page);

    const afterStale403 = await page.evaluate(() => ({
      messageCount: document.querySelectorAll('.inbox-message').length,
      urlSearch: window.location.search,
      notice: (document.querySelector('.inbox-notice') || {}).textContent ?? null,
      feedback: (document.querySelector('.inbox-feedback') || {}).textContent ?? null,
      hasAccessLostCopy: document.body.innerText.includes('ไม่แสดงให้คุณอีกต่อไป'),
    }));
    check(afterStale403.messageCount >= 3, 'read-ack 403 จาก epoch เก่าต้องไม่ปิดหรือลบห้อง A ที่ได้รับอนุญาตใหม่แล้ว', afterStale403);
    check(afterStale403.urlSearch.includes(uuidA), 'URL ของห้อง A ต้องยังคงอยู่หลัง read-ack 403 จาก epoch เก่า', afterStale403);
    check(!afterStale403.hasAccessLostCopy, 'ห้ามแสดงข้อความ access-lost จาก read-ack 403 ของ epoch เก่า', afterStale403);
  },
};

export const scenarios = [S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12, S13, S14, S15, S16, S17, S18, S19, S20, S21, S22, S23, S24, S25, S26, S27];

/**
 * Shared support surface for the browser-proofs runner (run-proofs.mjs): the
 * same contract helpers the scenarios use, so the in-flow screenshot proofs
 * exercise exactly the same scripted adapters. Nothing here changes scenario
 * behaviour — it is only re-exported, test-side.
 */
export const proofSupport = {BASE, uuidA, uuidB, uuidD, json, ticketItem, threadFor, LIST_BODY, baseRoutes, configure, clickRow, postRequests};
