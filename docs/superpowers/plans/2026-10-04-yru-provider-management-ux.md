# PRV-03 / PRV-04 — Ordering, model status, quota และ minimal UI

Execution plan ของ [task board](../../tasks/V1_TASK_BOARD.md). Reorder/pricing/preview endpoints และ shared DTO มี component evidence แล้ว; selected test/quota/persistence/UI ยังทำต่อ. Prerequisites: DOC-01, PRV-01/02 contracts. อ่าน [provider design](../../architecture/AI_PROVIDER_DESIGN.md), [surface brief](../../ui/PROVIDER_SURFACE_BRIEF.md), [PRODUCT](../../../PRODUCT.md), [DESIGN](../../../DESIGN.md)

## Ownership

Root freeze shared types/DB/API และทำ additive migration, auth, integration. Luna max รับ observation/probe logic ใน files ที่มอบ; Luna high รับ UI ตาม frozen DTO. Root เป็นเจ้าของ `types/providers.ts`, `lib/ai/provider-admin.ts`, `lib/ai/types.ts`, registry/gateway เพื่อไม่ให้ agents แก้ชน. Reviewer เป็น read-only

## PRV-03A — Reorder persistence/API

Planned files: `lib/ai/provider-order.ts`, shared provider types/API, `app/api/providers/reorder/route.ts`, `app/api/providers/[id]/models/reorder/route.ts`, `tests/provider-order.test.ts`, `tests/database/provider-order.integration.ts`; additive migration ถ้าต้องเพิ่ม constraints/revisions

- RED actual PG: complete scope IDs/revisions required; duplicate/foreign/cross-purpose/missing IDs rejected; inactive/nonadmin denied; stale/concurrent save leaves prior order unchanged
- Contract: provider order global; model order within provider+purpose. Atomic authorization/locks/revisions/normalized priorities/audit ใน transaction เดียว ไม่เปลี่ยน key/enabled/cost/cooldown
- Preview ใช้ request-specific purpose/capability filtering/order เดียวกับ gateway: providerPriority→modelPriority→stableID, ไม่เกิน3attempts; แสดงprofileที่จำลองและsafe excluded reasons ไม่ทำ inference
- GREEN: save/reload order ตรง actual gateway, purpose isolation/ties deterministic, no HTTP ใน reorder transaction

## PRV-04A — Observations/quota

Planned files: `lib/ai/model-observations.ts`, `lib/ai/provider-quota.ts`, shared AI/store/provider types, `tests/model-observations.test.ts`, `tests/provider-quota.test.ts`, `tests/database/model-observations.integration.ts`; additive private observation schema

- DTO: provider/model revisions, purpose/action, nullable upstream HTTP, normalized safe result/code, latency/time, quota `{scope,source,unit,window,limit,remaining,resetAt,retryAfter,observedAt}`; no raw body/student prompt/key
- Persist model/action observations and latest revision view; config edits invalidate display without deleting audit history. Runtime success HTTP ต้องมาจาก adapter response ไม่เดา 200 จาก SUCCESS
- Provider-reported quota API/allowlisted headers เท่านั้น; validate finite/nonnegative/unit/window/scope. ไม่มี evidence→UNKNOWN; limit≤0 หรือหน่วย/ช่วงเวลาไม่ตรงกันห้ามทำ ratio
- Near ≤10% เป็น app warning ที่เสนอ เมื่อมี known counters; remaining0 แยกจาก RATE_LIMITED429. Shared quota อยู่ Provider ไม่สร้างตัวเลขเฉพาะแต่ละ Model
- RED→GREEN: true HTTP/status/action, null network timeout, stale config, role/privacy, runtime/probe metrics separation, quota UNKNOWN/near/exhausted/shared/unit/window

## PRV-04B — Selected model test/refresh

Planned files: `lib/ai/model-probe.ts`, `app/api/providers/[id]/models/[modelId]/test/route.ts`, `app/api/providers/[id]/quota/route.ts`, PRV-01 pricing refresh route, `tests/model-probe.test.ts`, `tests/database/model-probe.integration.ts`

- Validate session/role/origin/body/IDs/revisions/duplicate guard; commit snapshotก่อน HTTP; bounded transport/body/abort; reauthorize/revision checkก่อนบันทึก
- Startup generation/embedding probes pin FREE_ONLY แม้ config ALLOW_PAID. Testเฉพาะ selected model **ไม่มี fallback** และไม่เปิด model/เปลี่ยน priority/cost เอง; metadata health ไม่เรียก inference
- Fixed nonpersonal generation ตรวจ schema/tools; embedding ตรวจ actual dimension/index/model/finiteness/fingerprint. ไม่บันทึก raw prompt/answer ของนักศึกษา
- RED→GREEN: selected429ไม่เรียก modelถัดไป; paid/unknown HTTP0; metadata200ไม่กลายเป็น generation pass; invalidJSON/dimension failแม้200; timeoutHTTPnull; configeditระหว่างprobeไม่overwrite latest
- Refresh quota/pricing bounded/cached/manual; ไม่มี automatic generation polling

### Root persistence slice — current execution contract

Requirements: CH014/015/016/017, USR-STATUS/QUOTA/TEST. Files: CLI-generated additive observation migration, `lib/ai/model-observations.ts`, `lib/ai/provider-probe-admin.ts`, `lib/ai/provider-quota-admin.ts`, `lib/ai/provider-admin.ts`, `lib/ai/store.ts`, test/quota routes and actualPG `tests/database/provider-observations.integration.ts`. Pure network probe/quota remain Luna max-owned; UI remains Luna high-owned.

Private model observations retain action/purpose/config revisions and true upstream HTTP; private provider quota observations retain reported scope/unit/window and revision. Latest DTO reads only matching revisions; historical observations remain audit evidence. No student payload/key/raw upstream body is persisted. Runtime attempts append RUNTIME observations in the same usage transaction; probes never insert usage/resolution metrics.

Manual operations use durable per-provider/model leases (15seconds), minimum5seconds between starts per scope and maximum10 starts per provider in a60second window, checked under the provider lock. Busy/rate-held operations return409 CONFLICT. These are application limits, not upstream quota. Snapshot transaction commits before decrypt/network; bounded10second network completes before reauthorization/revision/lease-token persistence check. Provider config may be edited during network: stale response returns409 and cannot replace latest. Lease release is token guarded in finally and expiry allows recovery after process failure.

Acceptance: actualPG RED→GREEN for success200/error429/nulltimeout, selected-only/no fallback, probes absent from usage, role denial, shared quota freshness, duplicate lease/revision race, no SQL transaction at HTTP boundary, no DTO secrets, private grants/RLS. Full source unit/type/lint/build and clean migration replay remain PRV-05 gates.

## PRV-03B — Product minimal UI

Planned files: existing provider page/forms, `app/providers.css`, shared components ตาม incumbent pattern, `scripts/qa/provider-management-browser.mjs`. อ่าน installed Next docs และ impeccable craft floorก่อนcode; frozen DTO ต้องพร้อม

- Page title/add action/free policy/purpose tabs/provider groups/model rows ตาม brief; settings เปิดเมื่อแก้; vendor/protocol labelsถูกต้อง ไม่มี key readback
- ขึ้น/ลง draft + Save/Cancel ใช้ atomic API; keyboard names/live announcement/focus restoration/mobile touch targets; display order ตรง runtime
- Model row แสดง pricing proof/check time, HTTP/result/action/time, quota scope/unit/windowและ test; disabled/loadingเฉพาะ row พร้อม reason; load/network/409 recovery
- Browser: SuperAdminpositive/nonadmindenial, add/edit/catalog/model, save→reload→gatewayorder, selected-onlyprobe/cost/privacy, staleconflict, sharedquota/UNKNOWN/near/exhausted
- Visual verification desktop+mobile/200%zoom/longThai+IDs/keyboard/contrast/reducedmotion: หนึ่งรอบรวม → fixbatch → confirmอีกหนึ่งรอบ. ห้ามอ้าง visualpassก่อน screenshot/browserจริง

## PRV-05 — Integrated acceptance

Root รัน signed configured free RAG ด้วย controlled catalog/Chat/embedding transport พร้อม cost-policy fixtures; full PG/RLS/unit/typecheck/lint/build/review บน source รวมแล้ว. No open SQL transaction ที่ HTTP boundary, paid inference0, no identity/token leak. Additive guarded DEV syncหลังlocalgates; explicit stage/security scan/commit/noninteractivepush+remotehash

Live free account/Thai embedding quality/approved corpus/real OAยังแยก manual pending ตาม checklist. ไม่ใช้ mock catalog/statisticsในruntimeเพื่อให้หน้า UI ดูครบ
