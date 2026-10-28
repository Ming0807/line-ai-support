# OpenCode — OC-STAFF-03: LINE Staff onboarding and approval UI

คุณรับผิดชอบ Frontend + UI controller tests ของระบบสมัคร/อนุมัติ Staff ใน YRU AI Helpdesk. ทำ12งานด้านล่างต่อเนื่องใน worktree/branch ของคุณเท่านั้น จาก checkpoint ที่ root ส่งให้ ห้ามใช้ worktree เก่า/ฐาน045daa5หรือ9437654. ห้าม push, merge, rebase, reset, clean, deploy หรือแก้ฐานหลัก. Root กำลังทำ routing/DB/auth/API และทีมอื่นทำ Inbox/Incident จึงต้องรักษาขอบเขตไฟล์อย่างเคร่งครัด.

## เริ่มก่อนแก้

1. ยืนยัน pwd/branch/HEAD/git status. อ่าน AGENTS.md, docs/PROJECT_INDEX.md, docs/tasks/V1_TASK_BOARD.md, DEC187, master guide §51–56, docs/architecture/STAFF_LINE_BINDING_DESIGN.md และ docs/superpowers/plans/2026-10-28-chat-inbox-implementation.md. อ่าน installed Next16.3.8 docs ก่อนใช้ APIs. บันทึก actual baseline SHA ในรายงานส่งมอบ.
2. อ่าน types/staff-applications.ts ซึ่งเป็น frozen root-owned browser contract. ตรวจ existing login/auth/server-client/design tokens. ใช้ darkrail/alabaster/coral เดิม ภาษาไทย เข้าใจง่าย และรองรับมือถือ. Staff OA มีเพียงแจ้งเตือน/รับเคส/เปิด Dashboard; ไม่มี personal chat relay.

## ไฟล์ที่คุณแก้ได้เท่านั้น

- app/staff/apply/** และ app/staff/application/** — public layout รองรับผู้ที่ยังไม่เป็น active Staff
- app/(dashboard)/staff-applications/** — SuperAdmin approval UI
- app/login/line-login-entry.tsx — สร้างปุ่ม/คำอธิบาย reusable เท่านั้น; root จะ import เข้า login เดิมเอง
- app/staff-onboarding.css — ใช้ class prefix staff-onboard-
- tests/staff-onboarding-ui.test.ts และ tests/staff-approval-ui.test.ts
- docs/reports/OPENCODE_STAFF_ONBOARDING_REPORT.md — รายงานคุณเพียงไฟล์เดียว ไม่แก้ sharedboard/decision/design

ห้ามแก้ lib/**, types/**, supabase/**, services/**, app/api/**, scripts/**, .env*, package/lockfile, next-env, middleware/proxy, shared shell/nav, Inbox, TicketActions หรือ Incident UI. ถ้าขาด backend/config ให้บันทึก dependency พร้อม UX unavailable ที่ซื่อตรง ห้ามสร้าง endpoint สมมติ/เส้นทาง auth อีกชุดหรือ fake success. คุณสร้าง UI controller/helper ภายในโฟลเดอร์ที่เป็นเจ้าของได้.

## Root API contract ที่ต้องใช้

- GET /api/staff/onboarding -> StaffApplicationContext. 401 แปลว่ายังไม่ login; 503 แปลว่าบริการยังไม่พร้อม. ไม่แสดงฟอร์มสมัครจน authenticated + lineLinked. department list มาจาก API เท่านั้น.
- เข้าสู่ LINE: navigation GET /auth/line?next=/staff/apply. ผูกบัญชีเดิมที่ login อยู่แล้ว: /auth/line?mode=link&next=/staff/application. ไม่ใส่ชื่อ/LINE-ID/token ผ่าน query. ไม่ redirect ไป arbitrary next URL.
- POST /api/staff/applications JSON SubmitStaffApplication -> StaffApplicationItem. หนึ่งคนหนึ่งคำขอที่กำลังรอ; server เป็นผู้ตรวจจริง. ไม่ส่ง role/active/permissions หรือเชื่อ department ที่เลือกเป็นสิทธิ์.
- GET /api/staff/applications?status=PENDING&page=1&pageSize=25 -> StaffApplicationList. status= PENDING|APPROVED|REJECTED|SUSPENDED (optional); max pageSize100; แสดง pagination จาก server ไม่คำนวณ total จากหน้าเดียว.
- POST /api/staff/applications/[id]/decision JSON DecideStaffApplication -> StaffApplicationItem. APPROVE ต้องเลือก final department ที่ SuperAdmin ยืนยัน; REJECT ต้องเหตุผล. สมัครใหม่ได้แค่ STAFF; ไม่มีปุ่มให้ผู้สมัครยกตัวเองเป็น ADMIN.
- POST /api/staff/applications/[id]/suspend JSON SuspendStaffApplication -> StaffApplicationItem. ต้องยืนยันผลกระทบและเหตุผล.
- Mutation ทุกตัวใช้ credentials same-origin/JSON, requestId เดิมเมื่อ network/5xx ไม่ทราบผล. 409 รักษาร่าง+โหลดข้อมูลใหม่+ให้ผู้ตรวจตัดสินใจใหม่ ห้าม auto-approve/auto-retryด้วยrevisionใหม่. 401/403/404 ไม่เผยข้อมูลลับ.

## 12 งานที่ต้องส่งครบ

1. ตรวจ baseline/ขอบเขต/สัญญาและพบความขัดแย้งก่อนเริ่ม; ไม่ตีความรายงานเก่าเป็น backend ที่ทำแล้ว.
2. สร้าง typed injectable controller/adapter ใช้ production API ตาม contract; mock อยู่ใน tests เท่านั้น. แยก loading/error/unavailable/ready/empty/submitting/conflict/uncertain ชัดเจน.
3. LINE login entry มีคำอธิบายว่า LINE ยืนยันบัญชี ส่วนการทำงานต้องอนุมัติก่อน; ปุ่มเข้าบัญชีเดิมยังคงได้โดย rootintegration ไม่ลบ password recovery.
4. ฟอร์มสมัครกรอกน้อย: ชื่อจริง รหัสบุคลากร ฝ่ายที่ขอ. ไม่ให้กรอก technical LINE ID. validation ใกล้ช่อง, กรอก/กดซ้ำแล้วไม่หาย.
5. ผู้มีบัญชีเดิมใช้หน้าเชื่อม LINE ที่ชัดเจน ไม่สร้าง profileซ้ำหรือเดาจากชื่อ/อีเมล. lineLinked มาจาก server เท่านั้น.
6. หน้าสถานะส่วนตัวแสดง PENDING/APPROVED/REJECTED/SUSPENDED พร้อมเหตุผลที่ server อนุญาต, เวลาจริง และทางกลับไปหน้า login/Inbox. อย่าสร้างคำสั่งresubmitที่ backendไม่ได้ให้.
7. หน้า SuperAdmin มีรายการคำขอ, tabs/filter ตามstatus, searchภายในหน้าที่ระบุขอบเขตชัดหรือไม่ทำsearchหากserverไม่มี, paginationจริง และ empty/error/retry.
8. เลือกคำขอเปิดแผงรายละเอียด/drawer ที่เข้าถึงได้, แสดง requested กับ final department แยก, ชื่อ/รหัสผู้สมัครอาจยาวและต้องไม่ทำหน้าแตก.
9. Approve/reject/suspend ใช้ explicit confirmation, เหตุผล, CAS/requestId. สอง adminตรวจพร้อมกันต้องแสดงconflictไม่แสร้งสำเร็จ. ป้องกัน double-clickและout-of-order response.
10. Responsive1440/390/320, keyboard/focus/Escape/mobile drawer/labels/Thai200%zoom/reducedmotion. ไม่แสดง data/token/LINEsubject ในlog/URL/localStorage.
11. RED→GREEN tests วัดพฤติกรรมจริงของcontroller: validation, bodyexact/no-role, stale response, uncertain retry retainsrequestId,409preservesdraft, approvalneedsfinaldepartment,permission denial,totalsserver,logoutclearsstate. ไม่เขียนassertionตรวจข้อความsourceแทนbehavior.
12. Typecheck/changed-file lint/focusedtests/fullunit/buildเท่าที่environmentทำได้, git diff --check, stagedcredentialscan. หาก fake adapterใช้browserfixtureต้องติดป้าย FIXTURE; ห้ามอ้างliveintegration/auth/approvalผ่านจากfixtureหรือ screenshotHTMLอย่างเดียว.

## การส่งมอบ

Local commitsขนาดพอดี: UI/controllers → regressions → report. ไม่ push. รายงาน baseline/finalSHA/ไฟล์/คำสั่งexitจริง/REDและGREEN/ขอบเขตfixture/actualbrowser/ข้อค้างกับroot. ถ้า browserไม่พร้อมให้บอกNOT_RUN ไม่แต่งหลักฐาน. คงคำขอที่rootยังไม่รับเป็นPROPOSED ห้ามแก้backendให้เข้ากับUI. ส่ง root ตรวจทุกcommitก่อนรวม. ทำต่อเนื่องจน12งานนี้ครบหรือมีdependencyจริงที่แก้ไม่ได้ในขอบเขต; ไม่วนbenchmarkmodel/ไม่อ่านหรือใช้APIkeyจริง.
