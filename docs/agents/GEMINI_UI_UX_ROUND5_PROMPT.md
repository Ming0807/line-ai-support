# Gemini Round 5 — close workflow defects and finish the operator interface

คุณคือ Lead Product Designer และ Frontend Engineer ของ YRU AI Helpdesk ผู้ใช้ชอบหน้าหลักและ sidebar ปัจจุบันแล้ว ต้องการให้คุณทำงานต่อเนื่องเป็นรอบใหญ่จนปิดงานที่ทำได้ครบ อย่าจบรอบหลังเปลี่ยนสีหรือแก้เพียงหน้าเดียว งานที่ติด backend ให้บันทึก dependency แล้วเดินงานอิสระถัดไปทันที ส่งมอบ local commits และหลักฐานให้ Codex ตรวจรับ

## 1. พื้นที่ทำงานและฐานที่ต้องตรวจจริง

- Worktree ของคุณ: `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru`
- Branch: `codex/gemini-dashboard-ux`
- Frozen starting commit: **`1ce04c017fa32188aaa9f39df3e24c49b94efeb3`** หลัง Round4 ตรวจ HEAD และ working tree ก่อนเริ่ม ห้ามย้อนกลับไปเริ่มออกแบบจาก 443c227 ใหม่
- Root checkout อ่านอย่างเดียว: `D:\project-next\line-ai-yru`
- Root backend contract checkpoint: **`10344dae80f2349dbeca42efee24a32a86c1f900`** อ่านไฟล์ตาม SHA นี้ด้วย `git show` ได้ อย่าอาศัยรายงานเก่าที่อ้าง 1beecaa ว่าเป็น backend ล่าสุด
- **LOCAL COMMITS ONLY: ห้าม push, PR, merge, rebase, cherry-pick หรือ deploy** Root เป็นผู้ sync backend และรวมงานหลังตรวจรับ คุณห้ามแก้ main checkout, WIP หรือ service ของ Root
- คุณแก้ dashboard UI/components/styles, browser-only presentation helpers ใต้ `app/**`, UI tests และเอกสารงานของคุณได้ ห้ามแก้ `app/api/**`, `lib/**`, `types/**`, `supabase/**`, `services/**`, auth/crypto/workers/backend scripts หรือสัญญาที่ Root เป็นเจ้าของ
- Snapshot ของคุณอาจไม่มี API/DTO ใหม่ที่ Root ทำแล้ว ทำ frontend ตามสัญญาที่อ่านจาก Root และทดสอบผ่าน isolated fixtures ห้ามคัดลอก backend เข้า branch คุณหรือสร้าง mock API ใน production เขียน dependency เป็น `ROOT_BACKEND_SYNC_REQUIRED` ในรายงานแล้วทำงานต่อ
- ใช้ port 3010 ถ้าต้องรัน server ของคุณ บันทึก PID และวิธีหยุดเฉพาะ process ที่คุณสร้าง ห้ามปิด port 3000/3011 หรือฆ่า node/python แบบรวม
- ห้ามอ่าน/พิมพ์/ถ่ายภาพ/commit `.env`, password, API keys, private originals, technical LINE IDs, replyTokens หรือ request payload ส่วนบุคคล Fixtures ต้องเป็นข้อมูลสมมติที่ปลอดภัยและมีขอบเขตชัดเจน

## 2. อ่านก่อนลงมือและสร้างแผน

อ่าน `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/agents/WORKING_PROTOCOL.md`, `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` และ `docs/requirements/V1_REQUIREMENTS_MATRIX.md` จาก Root checkpoint

อ่านต้นฉบับใน `docs/requirements/sources/README.md` และ original overview §§30–36 ซึ่งระบุ 13 capabilities: Overview, Tickets, Incidents, Departments, Knowledge Base, Activities, AI Providers, AI Models, Fallback Rules, Usage, Analytics, Logs, Settings ไม่มี Student Management ใน V1 Models/Fallback อยู่ภายใต้ Providers ได้ ไม่ต้องสร้าง route ใหม่เพื่อเพิ่มจำนวนหน้า

อ่าน `DESIGN.md`, `docs/operations/BACKEND_UI_CONTRACTS.md`, subsystem designs ของ Import/Assistance/Structured Mapping/Structured Review/Ticket Reads/Providers/Embedding และ **`docs/reports/GEMINI_UI_UX_ROUND4_REVIEW.md`** โดยเฉพาะ findings ที่มี source lines

ก่อนแก้ Next.js ให้ตรวจ installed guide ใน `node_modules/next/dist/docs/` ตาม AGENTS ใช้ skill frontend/UI/UX ที่มีและเหมาะกับงานได้ โดยยังรักษา visual direction ที่ผู้ใช้ยอมรับ ไม่ต้องเสนอ theme ใหม่หลายชุด

สร้าง `docs/ui/GEMINI_UI_ROUND5_PLAN.md` ก่อน implementation ระบุ package ID, requirement/source section, ไฟล์ที่แก้, dependencies, acceptance และลำดับทำงาน ใช้ state/checklist เพื่อ resume ได้ ไม่แก้ DEC ของ Root หรือใช้ decision number ที่ชนกัน ข้อเสนอใหม่ของคุณใช้ชื่อ `GEM-R5-*` และสถานะ PROPOSED

## 3. ผลตรวจ Round4 ที่ต้องแก้ก่อน

Root ตรวจ actual fixed diff `9aaab484..1ce04c017` แล้วพบว่าการ compile ผ่านยังไม่ปิด workflow:

1. Tickets ยังส่ง filters ที่ไม่มี `q/page/pageSize` เข้า `listTickets` แล้วกรอง/แบ่งหน้าใน array ที่โหลดมาไม่เกิน 100 รายการ ทั้งที่ Root มี server search/pagination แล้ว
2. Mapping helper เติมเหตุผล exclusion เอง ตัดทุกตารางที่ไม่ได้เลือกอัตโนมัติ และ `startRowIndex` ที่ผู้ใช้กรอกไม่ถูกนำไปสร้าง mapping แหล่งข้อมูลโหลดไม่ได้ยังเดาขนาดจาก Row50 ได้
3. Saved mapping คืนเพียงตารางแรกและ fields แต่ไม่คืน ranges/exclusions ทั้งหมด ค่า header/end ถูกตั้งใหม่และ preview โหลดตารางแรกมาทับช่วงของตารางที่เลือก
4. Preview สำเร็จส่ง acknowledgment เข้า parent อัตโนมัติ ยังไม่มีการยืนยันผลโดยคน ส่วน source/preview ถูกบังคับให้ save ก่อนทั้งที่ Root รองรับก่อน save ครั้งแรก
5. Request epoch ตรวจแค่ก่อน `res.json()` ไม่ได้ป้องกัน response/body เก่าหลัง source/revisions/mode เปลี่ยน และ pending mapping ไม่ถูกผูกกับ parent locks
6. Review3/BOTH ส่ง chunk acknowledgment ให้ panel เฉพาะ `schemaVersion === 2`; เปลี่ยนกลับ RAG อาจเหลือ structured mapping ที่ผิด mode contract
7. Activities/Logs/Usage/Analytics/Incidents ยังเป็น shell มากกว่าตัวแสดง ready/error/empty ที่ทดสอบการทำงานจริง และมีศัพท์ backend อยู่ในหน้าของเจ้าหน้าที่
8. Fixed commit whitespace check ยัง fail ในเอกสาร แม้ working tree สะอาดแล้ว
9. `university_systems` และ `service_forms` ใน DATASET_SPECS เปลี่ยนเป็น field names ที่ไม่ตรง Root strict registry จึง preview ไม่ผ่าน ต้องอ่าน exact fields/nullability/types ของทั้ง7 datasets จาก Root อย่าเปลี่ยนชื่อให้ดูเข้าใจง่ายใน payload ใช้ Thai labels แทน
10. `handleStartCurrent()` เริ่มจาก schemaVersion1 แล้วคัดลอกแค่ metadata/action ของ saved3 ทำให้ stale recovery กลายเป็น forbidden downgrade ต้องรักษา schemaVersion3 แม้ clear/เริ่ม review ใหม่

เส้นทาง `preview.extraction.tables` เป็น DTO ที่ถูกต้องของ Root อย่าแก้เป็น path ที่คิดเอง ปัญหาคือการตรวจ shape/binding และจัดการ failure โดยไม่เดาข้อมูล

## 4. งานรอบใหญ่ 20 packages

ทำ 01–08 ก่อน แล้วทำ 09–18 ตาม dependencies ปิดด้วย 19–20 แต่ละ package เริ่มจาก failing behavioral check เมื่อเป็น defect จากนั้นแก้ production และตรวจผลจริง Tests ต้องเรียก production component/controller/helper ไม่เขียนสำเนา implementation ใน test เพื่อให้จำนวน tests ดูมาก

### UX-R5-01 — source/bootstrap DTO และ pending propagation

Sources: CH038/041/047/049/050; `STRUCTURED_REVIEW_DESIGN.md`, `import-structured-plan.ts`, actual route DTOs. Files: mapping panel, frontend contract/parser/controller, review parent, UI tests

- รองรับ GET `/api/knowledge/imports/[id]/structured` และ POST route เดียวกันก่อน saved review แรก ตาม current counters ของ Root อย่าบังคับ save เพื่อ bootstrap
- ตรวจ response ที่ runtime ก่อนใช้: job identity/revisions, checksums/digests, plan/binding, acknowledgment และ publication flag ไม่ใช้ type assertion แทน validation
- ตรวจ browser DATASET_SPECS กับ exact Root registry/payload schemas ทั้ง7 datasets: `university_systems` คือ `code,name,description,url,support_url`; `service_forms` คือ `name,description,form_url,requirements` ห้ามส่ง system_code/form_code/download_url หรือ fieldsที่สร้างเอง Thai labelsเปลี่ยนได้แต่payload keys/types/nullability/transformsต้องตรง ทำ contract-check fixturesที่ตรวจ generated requestกับ frozen Root schema โดยไม่แก้backend
- ตรวจ preview inventory จาก `preview.extraction.tables`/locations และ binding ของ extraction/job จริง หาก missing/malformed/failure แสดง recovery และปิด preview ห้ามสร้าง fallback table/row counts จาก 50 หรือ input
- Source/preview pending ต้องถึง parent ป้องกัน save/source edits/approval ซ้อนกับงานที่ยังไม่เสร็จ ตาม locks เดิม ไม่ล็อก navigation ทั้งเว็บ

Acceptance: all7dataset request mappingsตรง frozenRoot schemaรวมsystems/forms; unsaved source GET→mapping→preview ใช้ได้ใน matching-contract fixture; malformed/401/403/404/409/413/422/503 ไม่สร้าง valid draft; source เก่าหรือ publication flag ที่ขัด contract ไม่ผ่าน; no duplicate click และ parent busy ตรงจริง

### UX-R5-02 — inventory ของตาราง/คอลัมน์ที่คนเข้าใจได้

Sources: CH041/042/049; `STRUCTURED_MAPPING_DESIGN.md`. Files: mapping source viewer/table chooser/browser-only state

แสดงตาราง/worksheet/page, จำนวนแถว/คอลัมน์จริง, headers และ bounded source samples ทุกตารางก่อนตัดสินใจ ให้คนเลือก include/exclude พร้อมเหตุผลของตนเอง ข้อเสนอจากระบบยังต้อง review ไม่ตั้ง NOT_THIS_DATASET ให้ทุกตารางเงียบ ๆ รองรับหลาย included tables ตาม Mapping1 จำกัดขนาดตาม Root ชื่อคอลัมน์ยาว/ไทยยังอ่านได้ ไม่ให้ผู้ใช้เดา ColumnIndex

Acceptance: one/two/multiple tables, headerless/empty/unequal row widths; include 2 tables และ exclude 1 โดยมี note จริง; ตารางที่ยังไม่ตัดสินใจทำให้ coverage ยัง incomplete; inventory unavailable ไม่กลายเป็น 1 table

### UX-R5-03 — complete row disposition ที่รักษาข้อมูล

Sources: CH041/049; Mapping1 ranges contract. Files: row disposition editor, validation/helper, mapping payload builder

ทุกแถวต้องเป็น DATA หรือ explicit HEADER/NON_DATA โดยไม่มี gap/overlap แสดงช่วงและ source samples ให้ตรวจได้ รองรับ non-data กลางตารางและ multiple data ranges ให้ first/last row มีผลจริง ห้าม clamp ช่วงผิดให้ดูเหมือนผ่านหรือสร้าง exclusion notes เองเพื่อผ่าน validation

ใช้ label แถวที่อ่านง่ายและแปลงเป็น zero-based index เฉพาะ payload แสดงจำนวน included/excluded/unreviewed ตรวจ reason/note ตามสัญญา Root ก่อน preview ค่า suggested header ไม่เท่ากับได้รับการยืนยันจากคน

Acceptance: input start/end เปลี่ยน payload และตัวอย่างจริง; middle footnote; last row boundary; invalid gap/overlap/out-of-bounds/empty/all-excluded; notes ที่คนกรอกคงเดิมและไม่ถูกเติมแทน

### UX-R5-04 — save/reload mapping ครบและไม่ทำข้อมูลหาย

Sources: CH047/049/050; review3 schema/legacy guard. Files: review types/state, mapping editor, review-form

Restore mapping ทั้งหมด: dataset, source, tables, field kinds/transforms/null policies/constants/notes, data/excluded ranges, excluded tables และ acknowledgment ที่ยังผูกกับ snapshot เดิม ไม่มีค่า hardcoded header1/end50 มาแทนข้อมูลบันทึก Preview inventory ห้ามทับช่วงของ saved table

Edit fields/ranges ต้องส่ง draft mapping ที่ acknowledgment เป็น null กลับ parent ได้โดยยังไม่ preview ไม่ล้างทั้ง mapping เป็น null ทุกครั้งที่แก้ Root รองรับ draft ที่ยังไม่ acknowledgment แยก dirty/baseline/source-stale ชัดเจน Back/reload/conflict ต้องให้คนเลือก discard/reapply หลังดู source ปัจจุบัน ไม่มี silent merge

Acceptance: save→GET review→remount ได้ multi-table mapping เดิมทุกค่า; editing→save ก่อน preview ร่างไม่หาย; preview failure/409 รักษา edits; dataset change ไม่ปะปน fields; completed publication receipt ยังล็อก immutable source/draft ตามระบบเดิม

### UX-R5-05 — deliberate acknowledgment และ mode transitions

Sources: CH038/041/050; `lib/imports/review-schema.ts`, structured review design. Files: review-form, mapping preview/confirmation, chunk panel wiring

Preview success แสดงผลและ provenance/warnings ก่อน acknowledgment เป็น null จนคนกดยืนยันด้วย explicit control ที่มี label และ uncheck ได้ การยืนยันรับเฉพาะ content acknowledgment ที่ server ส่ง ห้ามสร้าง hash/counter เอง Field/range/dataset/source revision เปลี่ยนต้อง invalidate ack

Review3 ต้องไม่ downgrade กลับ1/2 Explicit clear ยังคง3 STRUCTURED มี chunkPlan:null; BOTH แสดงและ restore ทั้ง chunk/mapping acknowledgment; RAG ห้ามส่ง structured mapping ที่ไม่เข้ากับ mode การเปลี่ยน mode ที่จะลบร่างต้องสื่อสารผลและให้ตัดสินใจเฉพาะข้อมูลที่ได้รับผลกระทบ

Stale recovery/เริ่มตรวจฉบับปัจจุบันใน `handleStartCurrent()` ต้องรักษา schemaVersion floorจากsaved receipt แทนการใช้ emptyDraft1อย่างเดียว ล้างattestations/ackที่ต้องreviewใหม่ได้แต่ห้ามสร้าง3→1 requestแล้วให้ผู้ใช้ติด409วน

`publicationAvailable:false` ยังคงหมายถึงยังเผยแพร่ STRUCTURED/BOTH ไม่ได้ แม้ isolated schema tests ของ Root ผ่านแล้ว อย่าเปิดปุ่มเผยแพร่หรือสลับ RAG อัตโนมัติ

Acceptance: preview success ไม่ auto-ack; explicit ack→save→reload; edit invalidates; BOTH retains both acknowledgments;3→clear stays3; invalid mode/dataset combinations ไม่ส่งไป server; publication unavailable แสดงขั้นต่อไปโดยไม่กล่าวว่าตรวจสำเร็จทั้งหมดแล้ว

### UX-R5-06 — asynchronous fencing และ stale recovery

Sources: CH047/049/050; current job/extraction/review counters and receipt locks. Files: real mapping controller/parent integration/tests

GET inventory, GET source, POST preview ทุกคำขอมี cancel/epoch และผูกกับ job/counters/dataset/mode/input snapshot ตรวจความยังเป็นปัจจุบันหลังทุก await รวม response body parsing และก่อน parent callback Error/finally ของ request เก่าห้ามล้างผลหรือปลด pending ของ request ใหม่

Invalidate/cancel เมื่อแก้ input เปลี่ยน source/revisions เปลี่ยน dataset/mode โหลดใหม่ หรือ unmount ไม่ใช่เฉพาะเริ่ม POST ใหม่ ไม่ auto-retry mutation ด้วย counter ใหม่หลัง409 โหลด source ล่าสุดแล้วให้คน review ร่างเดิมอย่างชัดเจน

Acceptance: deferred fetch/body promises reproducing A→B, edit during source load, second response overtakes first, old error after new success, review counter changes after save, unmount/double click; stale result ไม่เขียน draft/ack/UI และไม่เปิด approval

### UX-R5-07 — ticket search ส่งถึง server จริง

Sources: CH051/USR-UX, TKT-READ-02; `TICKET_READ_DESIGN.md`, current `types/tickets.ts`, `lib/tickets/reads.ts`. Files: tickets/page, URL query parser and presentation helpers

ส่ง `q/page/pageSize` และ existing filters เข้า `listTickets` ตาม current Root contract หยุด local search/paging ของ 100-row sample Search เฉพาะ4 safe fields ที่ backend รองรับ: ticket_no/problem_summary/category/anonymous_code ไม่ขยายไป technical identity, department หรือ assignee

Canonical page1–10000/size1–100, q bounds/control-character policy ตาม Root ห้าม parseInt รับ `1bad`, `01` หรือค่าผิดเป็น page1 เงียบ ๆ Invalid filters ต้องมี recovery ที่ชัดเจน ไม่แสดงผลแล้วอ้างว่าใช้ filter ที่ไม่ถูกต้องอยู่

หาก local snapshot ไม่มี server DTO ให้ทำ frontend adapter ตามสัญญาจริงและ isolated service/request fixture ระบุ backend sync dependencyในรายงาน ไม่แก้ backend types หรือใช้ client filter เป็นผลค้นหาทั้งระบบ

Acceptance: service/request ได้ selectors จริง; Thai/literal `%/_/!`; matching ticket อยู่นอก100แรกยังปรากฏจาก returned page; cross-scope fixtureไม่รั่ว; valid/invalid/duplicate query behavior ตาม Root

### UX-R5-08 — truthful pagination, URL และ empty recovery

Sources: CH051/066/USR-UX; returned `pagination` contract. Files: tickets pager/count/empty/error components

ใช้ page/pageSize/total/totalPages/hasNext/hasPrevious จาก server ไม่คำนวณ total จาก returned array ไม่ clamp out-of-range page ไปสุดท้ายอัตโนมัติ Missing pagination หมายถึงยังตรวจ total ไม่ได้ ให้แสดง unknown ไม่สร้าง0/100

เปลี่ยน filter/search reset page แต่คง pageSize; เปลี่ยนหน้ารักษาทุก valid filter; browser Back/Forward คืน query และ UI ตรง; empty match, out-of-range และ unavailable แสดงคนละ state พร้อม action

Acceptance: total250/page2 returns25; total0; empty pageที่ยัง total250; missing pagination; changed filters; retained URL parameters; keyboard pager/currentpage/disabled boundaries

### UX-R5-09 — assisted import journey ที่ไม่กรอกทุกอย่างตั้งแต่แรก

Sources: USR-IMPORT-EASE/IMPORT5, CH036/037/043/044/047/049/050. Files: upload form/import workspace/review sections/source editing

ทำ flow เลือกไฟล์หรือ URL→วิเคราะห์→ตรวจสาระสำคัญ→บันทึกร่าง→ดูตัวอย่าง→ยืนยัน มีหนึ่ง primary action ต่อขั้น Label ไทยสั้น ชัดว่าอะไรจำเป็น/แนะนำ/ยังไม่ทราบ Advanced fields ซ่อนไว้ใน disclosure ที่เข้าถึงได้และเปิดเมื่อจำเป็นต่อ validation

Assistance ไม่ทับ manual draft ค่า department/family มาจาก current registry จริง แยก suggested values กับ operator decisions การยืนยัน source authority/effective dates/scope/version/warnings/5 attestations ยังเป็น deliberate ไม่ใช้ upload year เป็น effective date ไม่ลด review safeguards เพื่อให้ดูง่าย

Acceptance: PDF/DOCX/XLSX/CSV/officialURL fixtures ตาม actual contracts; unavailable assistance;400analyze/409preview รู้ว่าต้องทำอะไรและไม่กรอกใหม่ทั้งชุด; saved/manual valuesคงเดิม; receipt recovery/locksเดิมไม่ถดถอย

### UX-R5-10 — ticket detail และ queue เป็นพื้นที่ทำงานเดียวกัน

Sources: CH007/008/025/026/051–053/USR-UX. Files: ticket detail/action/composer, dashboard queue, ticket styles

จัด summary/history/HUMAN mode/assignee/delivery/composer/actions ให้ hierarchy ชัด ปุ่มตาม returned permissions ไม่คำนวณสิทธิ์จาก role ที่คิดเอง Preserve unsent draft เมื่อ response failed Unknown delivery ไม่กล่าวว่าส่งถึงนักศึกษาแล้ว ไม่มี automatic retry สำหรับ mutation ที่ผลยังไม่ชัด

Existing Accept/Reassign/Reply/Resolve/Close action ใช้ real endpoint and revisions เท่านั้น Similar Tickets/Suggested Knowledge ที่ยังไม่รองรับแสดง unavailable ที่สุภาพ ไม่มี fake recommendation

Acceptance: action permissions; double click;409 stale revision; safe network failure and preserved text; accepted/queued/deliveredต่างกัน; mobile/keyboard composer; queue→detail→back contextไม่หาย

### UX-R5-11 — knowledge catalog/history/relationships ใช้งานต่อเนื่อง

Sources: CH009/039/040/046/060/062/USR-UX. Files: knowledge page/panels/list/detail/history/version selection

ใช้ current Root catalog/family/history/detail DTO แสดง current/superseded/historical, effective/applicability/authority และ relationships โดยไม่ให้สี badge ตัดสิน eligibilityแทน backend Search/filter/detail/back/retry รักษาบริบทและ permission Unexpected sensitive/missing/denied response ไม่แสดง stale private content

Root ยังมี catalog UI WIP ของตนเอง คุณห้ามแตะ root files ทำใน worktreeคุณและรายงาน overlap paths เพื่อ root reconcile ไม่ลอกไฟล์ WIP มาเป็น authoritative contract

Acceptance: version history/current selection/cancellation/amendment fixtures; permission/notfound/unavailable; search/filter query retained; modal focus/close/back; draft/import jumpมี exact target

### UX-R5-12 — Providers/Models/Fallback ครบ workflow เดิม

Sources: CH014/029/030/070, USR-ORDER/STATUS/QUOTA/TEST/FREE. Files: provider page/forms/panels/styles

ตรวจ current controls และแก้ gaps จริง: provider AND model up/down, keyboard/mobile focus, save/reload order, correct revision guards, per-model test state and cooldown, fallback previewตาม purpose/current rules Navigation ต้องไป #models/#fallback ที่มีจริง

Runtime observation กับ manual probe แยกแหล่ง/เวลา HTTP200 ไม่รับประกัน response usable/remaining quota 429ไม่ทำให้รู้จำนวนคงเหลือเอง Shared key/account quotaมีscope/unit/window/unknownตามDTO Startup FREE_ONLY ใช้ free verified services; paid additionsเป็น university explicit UI choiceภายหลัง ไม่auto-enable paid fallback

Acceptance: reorder/save/reload/conflict; one selected-model probeไม่ทดสอบทุกmodel;200invalidbody/429/nulltimeout/unknownquota; disabled/pending buttons; no requestcredentialsrender/log; local E5 embeddingไม่กลับเข้าปุ่มเลือกgenerationprovider

### UX-R5-13 — Activities: ready renderer และ search/detail controller

Sources: CH015/016/060, original§31, USR-DASHBOARD. Files: activities page/client panel/viewmodel/UI tests

ทำ reusable production renderer/controller สำหรับ loading/ready/empty/unavailable/error และ filter/rowdetail/period/retry ที่ทดสอบด้วย fixturesได้ Actor labelsและscopeตามactualrolesเท่านั้น Audit detailsเฉพาะapproved safe fields ไม่dumpmetadata

ถ้า aggregate APIยังไม่มี Productionยังแสดงunavailableและexistingactionที่ทำได้จริง ส่วน ready fixtureอยู่ในisolatedQAไม่เปิดdemo dataบนหน้า production ข้อเสนอ DTOอยู่ในเอกสาร PROPOSED ไม่ผูกเข้าปลายทางเดาเอง

Acceptance: scoped ready/empty/error, filters/detail and keyboard; stale cancellation; rawtoken/LINEidentity fixturesไม่ปรากฏ; no developer contract text in operator view

### UX-R5-14 — Logs: แยก error และ operational records อย่างอ่านรู้เรื่อง

Sources: CH015/016/060, USR-DASHBOARD. Files: logs page/panel/controller/detail presentation

สร้าง ready/error/empty/unavailable renderers ใช้ safe error code/status/time/category/actionable next step ไม่แสดง stack/raw provider body/header/request payload Search/severity/period/page/detail เป็น actual tested UI ตาม approved contractหรือfixture-onlyproposal

Retry ต้องเรียก existing read loaderจริง ถ้ายังไม่มีendpointอย่าวางปุ่มลองเชื่อมต่อที่กดแล้วไม่มีงาน หรือสื่อว่าemptyเพราะไม่มีerror Safe linkไปexistingprovider/ticket viewได้เมื่อมีauthorizedtarget

Acceptance: failurevszero records; long error codes/model labels; detail redact fields;409/503 recovery where applicable; URL/back and keyboard; unavailable productionไม่มี fake success

### UX-R5-15 — Usage: observations และ quota ที่มีหน่วย/ขอบเขต

Sources: CH015, USR-QUOTA/STATUS/DASHBOARD. Files: usage panel/viewmodel/charts/table/filter controller

สร้าง ready rendererที่รับapprovedobservationsหรือfixture-onlyproposedDTO Request/token/latency/quota/cost แสดง unit/source/scope/period/lastchecked/unknownที่ตรงข้อมูล ห้ามรวมคนละquota window หรือสร้างยอดค่าใช้จ่าย/cache hit rateเอง ปุ่ม filter/date/modelและretryต้องมีbehaviorที่ทดสอบได้

Acceptance: partial population/unknown cost/shared quota/missing counter; no-data vsnetworkerror; chartเท่ากับaccessibletable; scoped period change/back; no observationไม่มี0หลอกตา

### UX-R5-16 — Analytics: metric definitions และ stateful views

Sources: CH015/USR-DASHBOARD; original§30–31. Files: analytics panel/viewmodel/filters/charts/table

สร้าง renderers สำหรับ scoped analytics เมื่อมีcontractที่Rootรับรอง หากยังไม่มีให้ทำfixture-onlyproposedpresentation แต่ห้ามคำนวณ MTTR/AI-resolved ทั้งมหาลัยจาก latest100 Tickets

ทุก metricมีdefinition/timezone/window/population/sample completeness ข้อมูลไม่พอเป็นunknown/filter/searchยังใช้งานในisolatedfixture ไม่inventthreshold, SLA, resolution semanticsหรือtimeseries

Acceptance: scoped/sampled/incomplete/empty/unavailable/error; numeric count/average denominatorsถูก; period/url/back; chart/tableแสดงข้อมูลตรงกัน; labelsไม่กล่าวว่าเป็นinstitution-wideเมื่อscopeจำกัด

### UX-R5-17 — Incidents: list/detail/filter ที่พร้อมเชื่อม contract

Sources: CH013/055–057/USR-DASHBOARD. Files: incidents page/panel/controller/detail and scopedfixtures

สร้าง tested ready/empty/unavailable/error list/detail/filter presentation ตัวอย่าง severity/statusต้องตรงsourceหรือlabelPROPOSEDในdocs ห้ามสร้าง incident detector/threshold/newstates/newroles/broadcast/create endpointเอง Productionที่backendยังไม่มีแสดงunavailableพร้อมไปticketworkflowที่มีได้

อย่าเขียนว่าหน้า Tickets สามารถรวมกลุ่มเหตุการณ์ได้แล้วเมื่อยังไม่มี actionจริง การกดดู related ticketsต้องใช้authorizedreferencesจากDTOหรือfixture ไม่ค้นข้อมูลส่วนตัวเอง

Acceptance: scoped filter/detail/related links, keyboard/mobile;missing backendno fake detector;permissiondeniedclearsdetail;zero-countrequiresobserveddata; proposalไม่อ้างrootacceptance

### UX-R5-18 — Overview/Settings/Departments และภาษาในทุกหน้า

Sources: CH060/065/066, USR-DASHBOARD/UX/EMB-LOCAL. Files: dashboard/intake helper/settings/departments/app shell/shared styles

รักษา home/sidebar/composition ที่ผู้ใช้ชอบ: dark rail #141622, warm alabaster #f4f3ef, white rounded cards1.75rem, sunset coral #f25c54 และไม่มีgreen paletteเดิม

Overview chartกำหนดrolling7×24hหรือ7Bangkokcivil daysให้labelตรง helper/currentclockและtable Sources/time/sample100/unknownไม่หาย Staff-profile Supabase lookupเป็นหลักฐานเฉพาะreadนั้น ไม่ใช่applicationDBpool/queue/LINEhealth Healthแบ่งconfigured/observed healthy/unhealthy/unknownตามจริง 9departmentsเป็นseedreferenceไม่ใช่CRUDที่ใช้งานแล้ว

เอา `ROOT_BACKEND_SYNC_REQUIRED`, schemaVersion/Mapper/CAS/technical contract lectures ออกจากoperator copy ใช้ไทยบอกสถานะและสิ่งที่ทำต่อได้ รายละเอียดวิศวกรรมอยู่ในdocs ชื่อfield/transformcodesที่จำเป็นอยู่ในadvanceddetails

Acceptance: exact timebounds/future/invalid/zero/APIerror; no misleadinghealthy; longThai/modelIDs/URLs; consistent button/input/status/date patterns;ทุก13capabilitiesรวมlogin/detail/queue/importอยู่ในdesignเดียวกัน

### UX-R5-19 — functional browser/keyboard/mobile acceptance

Sources: CH066/070/USR-UX. Files: existing UI/browser test tooling, safe fixtures, screenshot outputs

ทดสอบ critical workflowsผ่านproductioncomponent/controller/request contracts ให้ครบ mapping unsaved/save/reload/ack/stale/error, server-ticketq/pages, ticketcomposer/queue, providersordering/probe, cataloghistory, login/logout/permissions ใช้isolatedfixturesเมื่อbackend snapshotยังไม่syncและระบุscopeตรงจริง

Desktop1440×900/mobile390×844 และcriticalforms320px/zoom200% KeyboardTab/ShiftTab/Escape/focusreturn/dialogtraps/drawer/body-scroll/ariaและstatus announcements ไม่มีpagewideoverflowยกเว้นlabeledtable scroller Screenshotsต้องเห็นworkflowstatesไม่ใช่แค่loginหรือshell

ทำQAสองรอบแบบbounded: รอบแรกตรวจbatchและแก้functionalbugs; รอบสองยืนยันเฉพาะaffected ไม่วนpolishเพราะรู้สึกยังไม่สวยและไม่ข้ามfailedflowsเพื่อปิดงาน

Acceptance: testsแดงจากdefectsจริงก่อนfixเมื่อทำได้; correctedworkflowPASS; error/stale/pendingfixturesและactualinteractionevidence; nocredentialsในscreenshots/testlogs; browserfailure/reportingตรงจริง

### UX-R5-20 — final gates, coverage และ local handoff

Files: `docs/ui/GEMINI_UI_ROUND5_PLAN.md`, `GEMINI_UI_ROUND5_COVERAGE.md`, `GEMINI_UI_ROUND5_BACKEND_REQUESTS.md`, `docs/reports/GEMINI_UI_UX_ROUND5_REPORT.md`, scoped tests/artifacts

Coverageรายpackageต้องแยก UI_ONLY_SHELL / FIXTURE_BEHAVIOR_PASS / INTEGRATED_PASS / ROOT_BACKEND_SYNC_REQUIRED / BACKEND_CONTRACT_PENDING / MANUAL_PENDING พร้อมfile/test/evidence/dependencyจริง หน้าเปิดได้ไม่เท่ากับworkflowcompleteและfixturesไม่เท่ากับlivebackend/OA

Backendrequests ระบุsource/task/currentendpoint/exactgap/actoractualrole/scope/input/output/error/revision/privacy/unknownoutcomeและ**PROPOSED, NOT ROOT-ACCEPTED** Existing review3/ticket/catalog/assistance APIเป็นsyncdependency ไม่ขอให้Rootสร้างซ้ำ MissingM9contractsค่อยproposal ไม่แก้roles/businessstates/schemaตามใจ

รันและอ่านexitcodeของแต่ละคำสั่งแยกกันหลังfinalchanges:

```powershell
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=1
pnpm build
git diff --check 1ce04c017fa32188aaa9f39df3e24c49b94efeb3..HEAD
git diff --check
node scripts/security/check-staged.mjs
```

Credential checkerต้องรันหลังstageเฉพาะownedfilesและก่อนcommit ถ้าแก้ต่อให้รันaffectedchecksใหม่ Fixed-baseline whitespace checkต้องรันอีกครั้งหลังfinalcommit การรัน `git diff --check` บนcleanworkingtreeอย่างเดียวไม่ตรวจcommitteddiff ห้ามอ้าง1474tests/buildที่รายงานรอบ4เป็นผลfinalรอบนี้ ห้ามdisablelint/testrulesหรือignoreapp/testsเพียงเพื่อผ่าน

Commitแยกเป็นcoherentpackagesได้ แต่ทั้งหมดlocalonly Finalreportต้องมีbaseline/finalSHA/changedfiles/cleanหรือWIPจริง/commandsและexit/results/failuresที่แก้/boundedQAfixturevslive/reviewpending/remainingdependencies/PIDs/artifactsและวิธีหยุดserver

## 5. วิธีเดินงานเมื่อมี dependency

ทำ P1 workflow repairsก่อนแล้วเดินต่อทั้ง20packagesที่เป็นอิสระ ถ้าRootcontractยังไม่อนุมัติ ทำpresentation/controller/isolatedbehaviorตามproposalพร้อมunavailableproductionและหยิบงานอื่นต่อ ห้ามหยุดรอให้ผู้ใช้ตั้งค่า provider/LINE/loginหรือmigrationใหม่เพื่อทำfrontendที่ยังทำได้ ห้ามออกนอกขอบเขตไปทำ backendเอง

เป้าหมายรอบนี้คือเจ้าหน้าที่ใช้งานง่ายขึ้นและworkflowที่ตรวจได้ทำงานจริง: select→review→save→reload→recover และ search→filter→page→detail→back ไม่ใช่เพิ่มจำนวนหน้า/testsหรือรายงานทุกอย่าง100% ทั้งV1 Rootเป็นผู้ตรวจfinalintegration/Flow A–Fและรวมงาน คุณส่งมอบโดยไม่push
