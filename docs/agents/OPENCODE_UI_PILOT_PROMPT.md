# OC-UI-01 — controlled ticket search/pagination pilot

คุณเป็น coding agent ที่ผู้ใช้เลือกผ่าน OpenCode ทำงานจริงหนึ่ง vertical slice เพื่อให้ Codex ตรวจเทียบผลกับ Gemini ไม่ใช้ผลนี้จัดอันดับความสามารถทุกด้านของโมเดล บันทึก provider/model/version/reasoning ที่ใช้จริงเมื่อทราบ ห้ามเดาหรือบันทึก credentials

## Workspace และขอบเขต

ใช้ `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru` เริ่มจาก frozen Gemini commit **045daa5ee9e57ca7766c83c318f0c3aef2815262** ตรวจ working tree clean และ HEAD ก่อนเริ่ม หากมีงานของคนอื่นให้รักษาไว้และรายงานไม่ reset สร้าง local branch `codex/opencode-ticket-pilot` จาก SHA นี้ด้วย git switch -c (ถ้า branch มีอยู่แล้วตรวจ ancestry/worktree ก่อน reuse ห้าม overwrite)

Root `D:\project-next\line-ai-yru` อ่านอย่างเดียว Backend contracts checkpoint **10344dae80f2349dbeca42efee24a32a86c1f900**; root33fb2abมีassignment/reviewdocsเพิ่มเติม ไม่แก้ root WIP

แก้เฉพาะ `app/(dashboard)/tickets/page.tsx`, `ticket-helpers.ts`, presentation components/stylesที่จำเป็น และ isolated UI tests/docsของpilot ไม่แก้ `lib/**`, `types/**`, `app/api/**`, `supabase/**`, auth/workers/provider/LINE/mapping/businessstates ห้าม push/PR/merge/rebase/cherry-pick/deploy/reset/clean/อ่าน.envหรือprivateaccounts

อ่าน root AGENTS/index/board/master§51/CH051, USR-UX, `docs/architecture/TICKET_READ_DESIGN.md`, `docs/operations/BACKEND_UI_CONTRACTS.md`, Round5promptแพ็กเกจ07–08/19–20 และ installedNextguidesก่อนแก้ Next code ใช้ frontend/test skillsที่มี รักษาapprovedhome/sidebar/darkrail/alabaster/whitecards/coralเดิม

## Concrete defect และเป้าหมาย

ใน frozen `tickets/page.tsx:39–57` parserอ่าน q/page/pageSize แต่ safeFiltersไม่ใส่สามค่านี้ก่อน `listTickets` ต่อให้Rootbackendsyncแล้ว search/pagerก็อ่านpage1/size100ตลอด งานนี้ต้องปิด select query→validated server selectors→returned matching pagination→accessible pager/back/recoveryครบ

เขียน `docs/ui/OPENCODE_TICKET_PILOT_PLAN.md` ก่อนimplementation โดยระบุ task/req/files/dependencies/acceptance ห้ามหลบgapด้วยlocalfilterของ100รายการหรือค่าtotalจากarraylength

## Acceptance ที่ต้องทำครบ

1. ส่ง q/page/pageSize + department/status/priority/assignee/from/to/sensitivityที่validถึง serviceจริงตามRootcontract qtrim/literal4safe-fields, max200UTF16ก่อนtrim/noUnicodeCc; canonical page1–10000,size1–100(default1/100) ไม่รับ01/1bad/+1/decimal/arrayduplicate/unknownqueryเงียบ ๆ
2. Validate enum/UUID/date rangeตามRoot Invalid queryแสดงerror+recoveryและไม่เรียกserviceด้วยunfilteredreplacementที่แกล้งดูสำเร็จ ห้ามสร้างroles/scopesจากquery
3. Render server `pagination`จริง: page/pageSize/total/totalPages/hasNext/hasPrevious ไม่clampout-of-rangeเอง Missing paginationคือunknown ไม่เดาจำนวนรวม
4. Changing filters resets page but retains size; changing page retains allvalidfilters; Back/ForwardคืนURL/UIตรง query-preservinglinks encodedถูก, empty match vs out-of-range vsunavailableต่างกัน
5. Behavioral testsเรียกproductionpage/controllerและmockcurrentRootserviceDTOเฉพาะในtests จับargumentsจริงให้เห็น q/page2/size25ถูกส่ง ตัวอย่างtotal250/page2 มี25rows; missingpagination/zero/out-of-range/literalThai/invalidqueries/filters/scope recovery ไม่เขียนสำเนาimplementationในtests
6. Keyboard/mobile pager/filterตรวจจริงผ่านavailablebrowsertooling Desktop1440×900/mobile390×844 และ320pxcriticalform ไม่มีpagewideoverflow Focus/labels/currentpage/disabledstatesครบ Testserverใช้3010และrecordownPID ห้ามปิด3000/3011หรือkillnodeรวม
7. Snapshotเก่าของGeminiยังไม่มีRootbackendDTOใหม่: frontendadapter/browsertypesสามารถอิงfrozencontractได้โดยไม่แก้backend ห้ามcopyserverเข้ามา/mockAPIproduction หากทดสอบผ่านfixtureให้ระบุ FIXTURE_BEHAVIOR_PASS และ ROOT_BACKEND_SYNC_REQUIRED แยกจาก INTEGRATED_PASS ไม่ขอให้ผู้ใช้ตั้งcredentialsเพื่อทำงานที่testได้

เริ่มด้วยREDที่จับmissingselectorsก่อนแก้ แล้วGREENหลังแก้ ให้ทดสอบbehaviorที่มีผล ไม่เพิ่มcountด้วยstatictextassertionsหรือdisablelint rules

## Gates และส่งมอบ

รันactualtypecheck, lintchangedfiles, focusedtests; availablefulltest/buildตามscopeและreportnot-runตรงจริง ก่อนcommitstageเฉพาะownedfilesแล้วrun `node scripts/security/check-staged.mjs`; whitespaceทั้งworkingdiffและ **`git diff --check 045daa5ee9e57ca7766c83c318f0c3aef2815262..HEAD` หลังfinalcommit** ต้องตรวจcommitteddiffด้วย

ส่ง `docs/reports/OPENCODE_TICKET_PILOT_REPORT.md`: actualprovider/model/version/reasoningถ้ารู้, baseline/finalSHA/branch, files/commands/exits/RED→GREEN, taskelapsed/tokenusageเฉพาะที่observed, fixturevslive/browser evidence, failuresและlimitations, remainingbackenddependency, ownprocesses/stopcommands และlocalcommitonly **ห้ามpush**

ทำsliceนี้ครบและรายงาน ไม่ขยายไป20packages/Backend/M9ก่อนCodexreview ผู้ใช้ต้องการทดลองคุณก่อนมอบงานรอบใหญ่

## เกณฑ์ตรวจของ Codex

Source/spec correctness40, meaningfulbehavioraltests25, UX/recovery/accessibility20, scopeandtruthfulhandoff15 รวม100 คะแนน ใช้เป็นengineeringrubricของpilot มิใช่โมเดลbenchmarkมาตรฐาน Secret leak/backendscopechanges/fakeintegration/disablechecksเป็นacceptancefailureแม้รวมคะแนนสูง

Gemini045daa5เป็นbaselineที่ยังไม่ส่งselectorsและไม่มีrenderedworkflowtests Codexจะตรวจimprovementต่อbaselineนี้ การเทียบความเร็ว/tokenกับGeminiทำได้เฉพาะมีtask/source/budget/environmentเดียวกันและobservedusage; หากไม่มีจะรายงานว่าหลักฐานไม่พอ ไม่สร้างrankingหรือเปอร์เซ็นต์ขึ้นเอง
