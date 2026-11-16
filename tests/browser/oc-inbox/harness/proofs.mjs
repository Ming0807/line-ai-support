/**
 * OC-INBOX-05 browser proofs (commit 4, plan §8 item 4).
 *
 * These are IN-FLOW screenshot proofs of the same behaviours the mounted
 * scenarios already prove (green-c3-2 15/15, evidence with commit 3). Every
 * proof runs a real interaction sequence, captures labelled screenshots
 * at decisive moments (stored OUTSIDE the repository, per plan §5) and makes
 * at least one measured assertion. The fixture pages carry the FIXTURE label
 * in the DOM, so every screenshot visibly shows it.
 *
 * Screenshots: <SCREENSHOT_DIR>/<proof id>-<NN>-<slug>.png
 * Evidence JSON/MD: tests/browser/oc-inbox/artifacts/<label>/ (no binaries).
 */

import {ARTIFACTS_DIR, proofSupport} from './scenarios.mjs';

const {BASE, uuidD, json, ticketItem, threadFor, baseRoutes, configure, clickRow, postRequests} = proofSupport;

/* ------------------------------------------------------------------------ */
/* P01 — inbox selection: live-authority lifecycle panel on screen           */
/* ------------------------------------------------------------------------ */

const P01 = {
  id: 'P01-inbox-pane-actions-1440',
  title: '1440×900 inbox: เลือกรายการ → pane เปิด → TicketActions วางจาก authority สด (ปุ่ม lifecycle ตามสิทธิ์)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await shot('queue');
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await shot('pane-open-actions');
    const probe = await page.evaluate(() => ({
      panel: document.querySelector('.ticket-action-panel') !== null,
      acceptButton: Array.from(document.querySelectorAll('.ticket-action-panel button')).some(node => (node.textContent || '').includes('รับเรื่อง')),
      messages: document.querySelectorAll('.inbox-message').length,
    }));
    check(probe.panel === true, 'pane ต้องมี TicketActions panel (authority สดจาก record)', probe);
    check(probe.acceptButton === true, 'ปุ่ม lifecycle ต้องแสดงตามสิทธิ์ปัจจุบัน', probe);
    check(probe.messages >= 3, 'บทสนทนาแสดง record ของแถวที่เลือก', probe);
  },
};

/* ------------------------------------------------------------------------ */
/* P02 — detail route: authority refresh + assistant live revision           */
/* ------------------------------------------------------------------------ */

const P02 = {
  id: 'P02-detail-authority-assist-1440',
  title: '1440×900 detail route: refresh หลังบันทึก → สิทธิ์ถอน → ปุ่มหาย → ร่างผู้ช่วยผูก revision สด (S05 พร้อมภาพ)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
    const fresh = threadFor(ticketItem(uuidD, 4, 'เคสเด ทาดล กรณี D', 2, 'STAFF_HANDLING', 'HUMAN'), {revision: 8, perms: {accept: true, reply: true, resolve: false, close: false, reassign: false, reopen: false}});
    const assist = json({revision: 8, advice: {ticketSummary: 'สรุป', conversationSummary: 'สรุปบทสนทนา', replyDraft: 'ร่างตอบจากผู้ช่วย', suggestedDepartmentCode: null, suggestedPriority: 'MEDIUM', reason: 'เหตุผล', uncertainties: []}, historyTruncated: false, knowledgeStatus: 'NOT_SEARCHED'});
    await page.goto(`${BASE}:${port}/fixture/detail?ticket=${uuidD}`);
    await configure(page, [
      {pattern: '^/api/chat/tickets/.*$', method: 'GET', mode: 'scripted', queue: [{status: 200, body: json(fresh)}]},
      {pattern: '/api/chat/tickets/.*/notes$', method: 'POST', mode: 'respond', status: 200, body: json({id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่ Fixtures', createdAt: '2026-10-28T01:12:00.000Z'})},
      {pattern: '/api/chat/tickets/.*/read$', method: 'POST', mode: 'respond', status: 200, body: json({readThroughSequence: 3})},
      {pattern: '^/api/tickets/.*/assist$', method: 'POST', mode: 'respond', status: 200, body: assist},
      {pattern: '^/api/tickets/.*/reply$', method: 'POST', mode: 'respond', status: 200, body: json({id: uuidD, status: 'STAFF_HANDLING', revision: 8})},
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.inbox-message').length >= 3, null, {timeout: 8000, polling: 30});
    await shot('details-boot-full-authority');
    await page.locator('.inbox-note-disclosure summary').click();
    await page.locator('#chat-note').fill('ข้อความส่ง');
    await page.locator('.inbox-note-disclosure form button[type="submit"]').click();
    await page.waitForFunction(() => document.body.innerText.includes('บันทึกบันทึกส่วนตัวแล้ว'), null, {timeout: 8000, polling: 30});
    await shot('after-refresh-withdrawn');
    const reassignButtons = await page.locator('button:has-text("เปลี่ยนผู้รับผิดชอบ")').count();
    check(reassignButtons === 0, 'ปุ่ม lifecycle ที่ถูกถอนสิทธิ์หายหลังรับ authority ใหม่', {reassignButtons});
    await page.getByRole('button', {name: 'ช่วยสรุปและร่างคำตอบ'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('ร่างคำตอบ'), null, {timeout: 8000, polling: 30});
    await page.getByRole('button', {name: 'นำร่างไปแก้ไขก่อนส่ง'}).click();
    await page.waitForFunction(() => document.body.innerText.includes('นำร่างไปไว้ในช่องตอบกลับแล้ว') || document.body.innerText.includes('ร่างนี้ไม่ตรงกับเคส'), null, {timeout: 8000, polling: 30});
    await shot('assistant-draft-applied');
    const composerValue = await page.locator('#chat-reply').inputValue();
    check(composerValue === 'ร่างตอบจากผู้ช่วย', 'ร่างผู้ช่วยเข้าช่องตอบกลับ (revision จาก record สด)', {composerValue});
  },
};

/* ------------------------------------------------------------------------ */
/* P03/P04 — mobile focus transfer + bounds (390×844, 320×844)               */
/* ------------------------------------------------------------------------ */

const P03 = {
  id: 'P03-mobile-focus-transfer-390',
  title: '390×844: คลิกแถว → focus เข้า pane (ไม่ติด display:none) → กลับ → คืน focus ห้องแถวเดิม (S09 พร้อมภาพ)',
  viewport: {width: 390, height: 844},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await shot('pane-open-focus-transfer');
    const afterSelect = await page.evaluate(() => ({
      tag: document.activeElement && document.activeElement.tagName,
      connected: document.activeElement ? document.activeElement.isConnected : false,
      hidden: document.activeElement ? getComputedStyle(document.activeElement).display === 'none' : true,
    }));
    check(afterSelect.connected && afterSelect.tag === 'BUTTON' && afterSelect.hidden === false, 'focus ต้องย้ายเข้า pane และเชื่อมต่อเสมอ', afterSelect);
    await page.locator('.inbox-back-mobile').click();
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await shot('back-to-list-focus-restored');
    const afterBack = await page.evaluate(() => ({
      tag: document.activeElement && document.activeElement.tagName,
      connected: document.activeElement ? document.activeElement.isConnected : false,
      hidden: document.activeElement ? getComputedStyle(document.activeElement).display === 'none' : true,
      inQueue: document.activeElement ? Boolean(document.activeElement.closest('.inbox-queue')) : false,
    }));
    check(afterBack.connected === true && afterBack.hidden === false, 'back ต้องคืน focus (แถวเดิมหรือ queue heading) ไม่หลุดจอ', afterBack);
  },
};

const P04 = {
  id: 'P04-mobile-composer-bounds-320',
  title: '320×844: composer ต้องไม่หลุดขอบจอ (D7 bounds)',
  viewport: {width: 320, height: 844},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.inbox-reply-form') !== null, null, {timeout: 8000, polling: 30});
    await shot('composer-320-bounds');
    const composerBox = await page.evaluate(() => {
      const rect = document.querySelector('.inbox-reply-form').getBoundingClientRect();
      return {left: rect.left, right: rect.right, viewport: window.innerWidth};
    });
    check(composerBox.left >= -1 && composerBox.right <= composerBox.viewport + 1, 'composer อยู่ใน viewport ที่ 320px', composerBox);
  },
};

/* ------------------------------------------------------------------------ */
/* P05 — Thai 200% zoom: layout usable + focus transfer still works          */
/* ------------------------------------------------------------------------ */

const P05 = {
  id: 'P05-thai-zoom-200-usability',
  title: 'zoom 200% (ภาษาไทย): ไม่มีแถบเลื่อนแนวนอนล้น + คลิกแถว/focus transfer ยังใช้ได้',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await shot('zoom-200-list');
    const overflow = await page.evaluate(() => ({
      zoom: document.documentElement.style.zoom,
      delta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check(overflow.zoom === '2', 'คำสั่ง zoom 200% ถูกใช้จริง', overflow);
    check(overflow.delta <= 2, 'zoom 200% ต้องไม่ทำ layout ล้นแนวนอนเกิน 2px', overflow);
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    await shot('zoom-200-pane-open');
    const focusProbe = await page.evaluate(() => ({
      connected: document.activeElement ? document.activeElement.isConnected : false,
      hidden: document.activeElement ? getComputedStyle(document.activeElement).display === 'none' : true,
    }));
    check(focusProbe.connected === true && focusProbe.hidden === false, 'focus transfer ยังทำงานภายใต้ zoom 200%', focusProbe);
  },
};

/* ------------------------------------------------------------------------ */
/* P06 — keyboard: Tab / Shift+Tab cycle never lands in a hidden element     */
/* ------------------------------------------------------------------------ */

const P06 = {
  id: 'P06-keyboard-tab-cycle-390',
  title: '390×844 Tab/Shift+Tab: ทุกจุดรับ focus ต้องเชื่อมต่อและแสดงผล (ไม่ติด display:none)',
  viewport: {width: 390, height: 844},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await clickRow(page, 0);
    await page.waitForFunction(() => document.querySelector('.ticket-action-panel') !== null, null, {timeout: 8000, polling: 30});
    const stops = [];
    for (let index = 0; index < 9; index += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const node = document.activeElement;
        return {
          tag: node && node.tagName,
          connected: node ? node.isConnected : false,
          hidden: node ? getComputedStyle(node).display === 'none' : true,
          back: Boolean(node && node.classList && node.classList.contains('inbox-back-mobile')),
          composer: node ? node.id === 'chat-reply' : false,
        };
      }));
    }
    await shot('after-tab-cycle');
    check(stops.every(stop => stop.connected && !stop.hidden), 'ทุกจุด Tab ต้องเชื่อมต่อและแสดงผล', stops);
    check(stops.some(stop => stop.composer), 'Tab cycle ต้องแตะช่องตอบกลับของ pane', stops);
    for (let index = 0; index < 9; index += 1) {
      await page.keyboard.press('Shift+Tab');
      const node = await page.evaluate(() => document.activeElement && document.activeElement.isConnected
        && getComputedStyle(document.activeElement).display !== 'none');
      stops.push({backTab: node});
    }
    check(stops.slice(-9).every(stop => stop.backTab), 'Shift+Tab ย้อนกลับต้องไม่หลุดเข้า element ที่ซ่อน', stops.slice(-9));
  },
};

/* ------------------------------------------------------------------------ */
/* P07 — reduced motion: the shipped promise measured numerically            */
/* ------------------------------------------------------------------------ */

const P07 = {
  id: 'P07-reduced-motion-1440',
  title: 'prefers-reduced-motion: duration ของแถวต้องลงทะเบียนที่ 0s หรือ ≤ .01ms (S09 comparator)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
    await page.goto(`${BASE}:${port}/fixture/inbox`);
    await configure(page, baseRoutes());
    await page.waitForFunction(() => document.querySelectorAll('.inbox-ticket-row').length === 2, null, {timeout: 8000, polling: 30});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await shot('reduced-motion-list');
    const rowTransition = await page.evaluate(() => {
      const raw = getComputedStyle(document.querySelector('.inbox-ticket-row')).transitionDuration;
      const value = parseFloat(raw);
      const toMs = /ms$/.test(raw) ? value : value * 1000;
      return {raw, ms: toMs};
    });
    check(rowTransition.raw === '0s' || (Number.isFinite(rowTransition.ms) && rowTransition.ms > 0 && rowTransition.ms <= 0.02), 'reduced motion ต้องปิด transition ของแถวจริง', rowTransition);
  },
};

/* ------------------------------------------------------------------------ */
/* P08 — approvals backlog: focus/inert, Escape during retained, 409 exit    */
/* ------------------------------------------------------------------------ */

const P08 = {
  id: 'P08-approvals-escape-pending-409',
  title: 'backlog งานบุคคล: dialog focus/inert → Escape ระหว่าง retained → uncertain → requestId เดิม → 409 ออกจากรายการ (S15 พร้อมภาพ)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
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
      {pattern: '^/api/staff/applications\\?.*status=PENDING', method: 'GET', mode: 'scripted', queue: [
        {status: 200, body: pendingRowBody},
        {status: 200, body: settledEmptyBody},
      ]},
      {pattern: 'api/staff/applications/.*/decision$', method: 'POST', mode: 'defer', key: 'decision'},
    ]);
    const rowActions = page.locator('.staff-onboard-row-actions').getByRole('button', {name: 'อนุมัติ', exact: true});
    await rowActions.waitFor({state: 'visible', timeout: 8000});
    await rowActions.click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') !== null, null, {timeout: 8000, polling: 30});
    await shot('dialog-open-focus-close');
    const focusProbe = await page.evaluate(() => {
      const outside = document.querySelector('h1');
      const before = document.activeElement;
      outside.focus();
      const after = document.activeElement;
      return {
        beforeIsClose: before && before.className.includes('drawer-close'),
        outsideInert: after !== outside,
      };
    });
    check(focusProbe.beforeIsClose === true, 'focus เริ่มที่ปุ่มปิด (native dialog cycle)', focusProbe);
    check(focusProbe.outsideInert === true, 'พื้นหลังต้อง inert ต่อ focus', focusProbe);
    await page.locator('#staff-onboard-final-department').selectOption('44444444-4444-4444-8444-444444444444');
    await page.locator('button:has-text("ยืนยันอนุมัติ")').click();
    await page.waitForFunction(() => Object.keys(window.__shim.deferredKeys()).length > 0, null, {timeout: 8000, polling: 30});
    const closeDisabled = await page.evaluate(() => {
      const closeButton = document.querySelector('.staff-onboard-drawer-close');
      return closeButton ? closeButton.disabled : null;
    });
    check(closeDisabled === true, 'close ถูกปิดระหว่าง pending', {closeDisabled});
    await page.keyboard.press('Escape');
    const dialogStillOpen = await page.evaluate(() => Boolean(document.querySelector('dialog[open]')));
    check(dialogStillOpen, 'Escape ระหว่าง retained ต้องไม่ปิด dialog', {dialogStillOpen});
    const pendingRequest = (await postRequests(page, 'decision$'))[0];
    await page.evaluate(answer => window.__shim.resolveDeferred('decision#1', answer), {status: 503, body: {error: 'INTERNAL'}});
    await page.waitForFunction(() => document.body.innerText.includes('ยังยืนยันผลการบันทึกไม่ได้'), null, {timeout: 8000, polling: 30});
    await shot('uncertain-notice-drawer-retained');
    await page.locator('button:has-text("ยืนยันอนุมัติ")').click();
    const decisions = await postRequests(page, 'decision$');
    check(decisions.length === 2, 'รีไทรหลัง uncertain', {decisions: decisions.length});
    const secondBody = JSON.parse(decisions[1].body);
    check(secondBody.requestId === pendingRequest.requestId, 'รีไทรใช้ requestId เดิม', {first: pendingRequest.requestId, second: secondBody.requestId});
    check(JSON.stringify(secondBody) === JSON.stringify(JSON.parse(pendingRequest.body)), 'payload คงเดิมระหว่าง uncertain retry', {first: pendingRequest.body, second: decisions[1].body});
    await page.evaluate(answer => window.__shim.resolveDeferred('decision#2', answer), {status: 409, body: {error: 'CONFLICT'}});
    await page.waitForFunction(() => document.body.innerText.includes('ไม่อยู่ในรายการล่าสุด'), null, {timeout: 8000, polling: 30});
    await page.waitForFunction(() => document.body.innerText.includes('ไม่มีคำขอในสถานะนี้'), null, {timeout: 8000, polling: 30});
    await shot('after-409-row-exited');
    const rowAfter409 = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-onboard-row-title')).some(node => (node.textContent || '').includes('ผู้สมัครสังเคราะห์')));
    check(rowAfter409 === false, 'แถว PENDING ออกจากรายการหลัง 409', {rowAfter409});
  },
};

/* ------------------------------------------------------------------------ */
/* P09 — onboarding apply: same-tick double submit, one POST                 */
/* ------------------------------------------------------------------------ */

const P09 = {
  id: 'P09-apply-double-submit-1440',
  title: 'onboarding apply: กดยื่นซ้ำใน tick เดียว → HTTP ครั้งเดียว requestId เดียว (S12 พร้อมภาพ)',
  viewport: {width: 1440, height: 900},
  async run(page, port, check, shot) {
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
    await shot('apply-form-filled');
    await page.evaluate(() => {
      const button = document.querySelector('button[type="submit"]');
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.__shim.requestsSnapshot().some(request => request.method === 'POST' && request.url.includes('/api/staff/applications')), null, {timeout: 8000, polling: 30});
    await page.waitForTimeout(150);
    await shot('after-double-submit');
    const posts = await page.evaluate(() => window.__shim.requestsSnapshot().filter(request => request.method === 'POST' && request.url.includes('/api/staff/applications')));
    check(posts.length === 1, 'double click ใน tick เดียวยิง HTTP ครั้งเดียว', {posts: posts.length});
    const ids = posts.map(post => post.requestId).filter(value => value !== null);
    check(new Set(ids).size === 1, 'requestId ต้องเดียวต่อการส่ง', ids);
  },
};

export const proofs = [P01, P02, P03, P04, P05, P06, P07, P08, P09];
export {ARTIFACTS_DIR};
