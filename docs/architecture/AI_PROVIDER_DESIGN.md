# AI Provider / Model — Design และ acceptance

10October UX-LIVE-01B: the Model test button no longer requires a cached FREE observation younger than one minute. A single selected test already refreshes trusted pricing in the backend before decrypting/sending the key or attempting inference; UNKNOWN/expired display evidence may therefore request that preflight. Fresh PAID evidence, missing key, unsupported configured capability and active cooldown still have explicit visible explanations. This removes a redundant UI prerequisite without changing FREE_ONLY, leases/revisions, actual upstream status, or allowing manual prices to certify eligibility. Administrator-configured application ceilings and vendor-reported remaining quota are different facts; no manually configured per-model quota feature is claimed by this UI correction.

Latest human update 5 October: normal UI manages GENERATION/reasoning only. Local CPU E5/384 is default embedding infrastructure; no normal embedding selection/dimension field or fallback is required. See [embedding design](EMBEDDING_SERVICE_DESIGN.md), DEC-021/022 and EMB plan. Internal external adapters/legacy registry rows remain for future compatibility. All older descriptions below of embedding UI/registry/preview describe retained internal or historical capabilities, not V1 default setup; generation up/down/per-model status/quota/test requirements remain unchanged.

สถานะ 5 ตุลาคม 2026: **Provider automated prerequisites passed; live free evidence pending**. [Acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md) แยก root gates/scoped Luna reviews/live gaps. อ่าน [ต้นฉบับ](../requirements/sources/original-overview.th.md) §§32–36, master §§14–15,29–31 และ [decision log](../decisions/DECISION_LOG.md) ร่วมกัน

## สิ่งที่มีอยู่จริงและ gap

| เรื่อง | Code ปัจจุบัน | งานที่ต้องทำ |
|---|---|---|
| Registry/configuration | encrypted keys, active SUPER_ADMIN, models/purpose/capabilities/revisions/audit | รักษา boundaries เดิม |
| Provider | official transports + compatible bounded public-DNS-pinned TLS, PG/UI configuration GREEN | live account/capabilities/Thai quality pending |
| Cost | fresh trusted FREE_ONLY gates + selected probes, explicit audited paid policy | signed configured free fixtures GREEN; live account pending |
| Priority | shared comparator/filter, atomic reorder/API, saved preview including cooldown | actual keyboard/mobile/save/reload/purpose browser GREEN |
| Health | per-model/action HTTP/result/time/latency observations, metadata distinct from inference | preserve actual/null HTTP; runtime never inferred from metadata200 |
| Quota | OpenRouter key/account counters persisted/scoped; near/UNKNOWN UI + bounded retry cooldown | live counters pending; HTTP alone never proves remaining |
| Test | selected per-model metadata/generation/embedding, no fallback, leases/revisions/free gate | actual PG/API/browser gates GREEN; paid startup probes never enabled |

หลักฐาน code: `types/providers.ts`, `lib/ai/provider-registry.ts`, `lib/ai/provider-admin.ts`, `lib/ai/store.ts`, `app/(dashboard)/providers/provider-forms.tsx`. การมี health button เดิมไม่ทำให้ per-model generation test เสร็จ

Automated evidence ล่าสุด: [provider acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md); live/fullV1แยกไว้. Catalog age1minute และ quota age5minutes เป็น application freshness ไม่ใช่ vendor guarantees. Saved preview ใช้ last observed catalog/ไม่เกิน3attempt positions; runtime ตรวจราคาใหม่เสมอ. Registry read64 enabled models/purpose. เปลี่ยน provider/endpointต้อง replacement key; canonical trailing slash/hostnamecase/default443ไม่ถือ endpoint change.

## Free startup และการเพิ่ม provider ภายหลัง

- ค่า default ทุก provider คือ `FREE_ONLY`; model ราคา `UNKNOWN`/ไม่ครบ/ไม่สดตาม policy จะไม่ใช้ inference และไม่ถอด key เพื่อส่งไปปลายทาง
- ราคา manual เป็น estimated display เท่านั้น ไม่ grant free eligibility. ชื่อ provider/model หรือ suffix `:free` ไม่พอ ต้องตรวจ trusted catalog และ actual availability/capabilities
- ใช้ Zen/OpenRouter เป็นทางเลือกเริ่มต้น โดยไม่ seed API key/model/dimensions จากการเดา; generation/embedding ต้องผ่าน cost gate เช่นเดียวกัน
- Catalog HTTP อยู่ใน total deadline เดียวกับ gateway และอยู่นอก DB transaction. OpenRouter inference free-only ส่ง price ceiling ที่ backend คุม; ไม่เพิ่ม paid plugins/hidden paid model fallback
- Paid provider/model เก็บเพื่ออนาคตได้ แต่ runtime จะเลือกเมื่อ active SUPER_ADMIN เปลี่ยนเป็น `ALLOW_PAID` โดยเจตนาและมี audit. **ปุ่ม Model test ในงาน startup นี้ยัง pin FREE_ONLY เสมอ** แม้ config มี paid opt-in; paid diagnostic ในอนาคตต้องเป็น action/contract ชัดเจนที่มหาวิทยาลัยเปิดเอง ไม่แอบเพิ่มใน probe. ไม่มี auto paid emergency ใน startup
- Compatible provider ผ่าน UI ใช้ validated HTTPS endpoint/protocol/public DNS pinning/no redirect ก่อนใช้งาน. เพิ่ม instance ที่รองรับ protocol แล้วไม่ต้องแก้ source ทุกครั้ง; protocol ใหม่จริงยังต้อง adapter. ห้ามทำ unrestricted proxy

แผนเทคนิค cost/protocol: [free provider execution plan](../superpowers/plans/2026-10-04-yru-free-ai-providers.md). Model ภาษาไทยและ embedding dimension ต้องทดสอบจริงใน free account ก่อนยืนยัน live acceptance

## ลำดับความสำคัญและ UX

Provider priority เป็นชั้นแรก Model priority เป็นชั้นถัดไป แยก `GENERATION` และ `EMBEDDING`; tie ใช้ stable record ID เช่นเดียวกับ gateway. ปุ่มขึ้น/ลงเปลี่ยนลำดับใน scope: provider list หรือ model list ของ provider/purpose นั้น. ต้องมี ordered fallback preview ที่ใช้ eligibility/order logic ร่วมกับ backend

Preview ต้องบอก purpose/capability profile ที่กำลังจำลอง (เช่น generation ที่ต้อง JSON/tools) และใช้ request-specific filters ของ gateway พร้อม cap **ไม่เกิน3attempts**. ไม่แสดง modelที่ใช้capabilityนั้นไม่ได้ว่าเป็นfallbackของrequestนั้น และไม่อ้างว่าลำดับเดียวใช้ทุกrequestโดยไม่ดูdeadline/tools/purpose

บันทึกลำดับแบบ atomic batch พร้อม revision ของทุกรายการใน scope. Validate ID ownership, purpose, uniqueness และ complete order ของ scope; lock ตาม stable order, ตรวจ active SUPER_ADMIN อีกครั้ง แล้ว normalize priorities และ audit ใน transaction เดียว. Stale revision ตอบ conflict; ห้าม update บาง row แล้วแสดงสำเร็จ. ไม่มี provider HTTP ระหว่าง save order

Disabled rows ยังจัดลำดับได้ แต่ preview runtime ต้องแยก `DISABLED`, `PRICE_UNKNOWN`, `PAID_BLOCKED`, `CAPABILITY_UNSUPPORTED`, `COOLDOWN` ตาม evidence. การเปลี่ยนลำดับไม่เปิด model/paid mode และไม่ล้าง cooldown เอง. เมื่อ free candidates ใช้ไม่ได้ทั้งหมด ระบบส่งต่ออย่างควบคุม ไม่เรียก paid candidate

UI composition/actions/states อยู่ใน [surface brief](../ui/PROVIDER_SURFACE_BRIEF.md); ปุ่มขึ้น/ลงใช้ได้เองโดยไม่พึ่ง drag. Save/Cancel แสดงเฉพาะมี draft order. Drag เป็น optional enhancement ของ API เดียวกัน

## Model observations: HTTP, result และ quota

Implementation/evidence exists in [acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md): private revision-matched views, leased selected tests/quota, actual runtime HTTP, minimal UI, configured free RAG fixtures, identity-fenced cooldown and compatible transport/configuration. Manual-operation leases/rate bounds are application protection (DEC-015), not upstream quota. In-flight observations retain original purpose across edits.

แต่ละ observation เก็บ model/provider IDs, configuration revision, purpose, `action` (`METADATA`, `GENERATION_TEST`, `EMBEDDING_TEST`, `RUNTIME`), `observedAt`, latency, nullable **upstream HTTP status**, safe normalized error/result, retry/reset และ quota source/scope/**counter unit/window** (requests/tokens/credits, per-minute/daily/monthly). ห้ามเทียบคนละหน่วย/ช่วงเวลา. DTO ห้ามมี key, key label ที่อาจระบุตัวตน, prompt/answer ของนักศึกษา หรือ raw error body

แยก Dashboard API HTTP ออกจาก upstream HTTP. Network/timeout ที่ไม่มี response ใช้ `httpStatus=null`; ห้ามใส่ 504 หรือ 0 แล้วแสดงว่า provider ตอบค่านั้น. Success runtime ต้องเก็บ HTTP จริงด้วย ไม่เก็บเฉพาะ error

| Evidence | ข้อความใน UI | การตัดสิน |
|---|---|---|
| ยังไม่มี observation | ยังไม่ทดสอบ | UNKNOWN |
| Metadata 200 | เชื่อมต่อได้ · Metadata 200 | ไม่อ้างว่า generation/embedding ผ่าน |
| Inference 200 + schema/capability validation ผ่าน | ทดสอบผ่าน · 200 | model/action ที่ตรวจเท่านั้น |
| Inference 200 แต่ invalid JSON/dimension/refusal/error payload | รูปแบบคำตอบไม่ผ่าน · 200 | ไม่แสดง healthy จาก HTTP อย่างเดียว |
| 429 มี rate-limit evidence | จำกัดคำขอ · 429 | cooldown ตาม Retry-After/reset เมื่อมี; ไม่เดาว่ารายวันหมด |
| remaining=0 จาก provider quota ที่มี scope | ถึงขีดจำกัด | ใช้ scope นั้นและเวลา reset ถ้ามี |
| remaining/limit ที่เชื่อถือได้ ≤10%, limit>0 และ unit/windowตรงกัน | ใกล้ถึงขีดจำกัด | ค่า warning ที่เสนอของแอป ไม่ใช่ข้อสรุปจาก HTTP |
| 401 / 403 | คีย์หรือสิทธิ์มีปัญหา | credential/access outcome ไม่ใช่ quota หมด |
| 402 ที่มี credit/limit evidence | เครดิตหรือวงเงินไม่พอ | ไม่เหมารวมกับ free request quota; ใช้ safe reason ที่ตรวจแล้ว |
| 400/404/422 | การตั้งค่า/Model ไม่พร้อม | ไม่เหมาว่า provider ทั้งเจ้าล่ม |
| 5xx | ผู้ให้บริการขัดข้อง | bounded fallback/cooldown ตาม policy |
| ไม่มี HTTP response | หมดเวลา/เชื่อมต่อไม่ได้ | ไม่สร้าง status code ขึ้นเอง |

**Quota scope** ต้องเป็น `MODEL`, `PROVIDER_KEY` หรือ `ACCOUNT` ตามที่ provider รายงาน. Shared key/account quota แสดงระดับ Provider และอ้าง “ใช้โควต้าร่วม” ใน Model rows ไม่ทำเป็นตัวเลขเฉพาะ model. ค่าหาย/unsupported/stale แสดง UNKNOWN พร้อมเวลา ไม่คำนวณ “เหลือจริง” จาก usage log ของแอป เพราะ key อาจใช้จากระบบอื่นด้วย

ข้อมูล primary ที่ตรวจ 4 ต.ค. 2026: [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits) อธิบาย `/api/v1/key` และ rate-limit headers รวมถึง account/key scope; [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) อธิบาย errors/retry hints. Adapter ต้อง feature-detect fields จริง และเก็บ null เมื่อไม่มี. [Zen](https://opencode.ai/docs/zen/) มีทั้ง free/paid models; หลักฐานที่ตรวจยังไม่ยืนยัน public per-model remaining-quota contract จึงไม่ hardcode ตัวนับ Zen

## ปุ่มทดสอบแต่ละ model

“ตรวจการเชื่อมต่อ” = bounded metadata request. “ทดสอบ Model” = fixed, short, nonpersonal probe สำหรับ selected model เท่านั้น: generation ตรวจ structured JSON/tools ตาม capability ที่ใช้จริง; embedding ตรวจ vector dimensions/index/finiteness/model identity. ไม่เปลี่ยน enabled/priority/purpose/cost policy และ **ไม่มี fallback** ที่ทำให้ model เสียแต่ปุ่มขึ้น green

ก่อน probe ตรวจ session/role/origin/body/rate limit/config revision และ FREE_ONLY catalog gate. Disable duplicate in-flight request ต่อ row. HTTP ภายนอกอยู่หลัง snapshot commit; เมื่อจบ reauthorize/check revision ก่อนบันทึก. Configuration เปลี่ยนระหว่าง test → stale/conflict ไม่ overwrite result ของ config ใหม่

Probe ทุกครั้งอาจใช้ free quota จึงทำเมื่อผู้ใช้กด ไม่ background generation polling. Metadata/quota refresh มี cache/timeout/bounded body/allowlisted headers; ไม่ fetch ทุก render จนกิน quota. ไม่เปิด paid probe แอบใน health check

## Proposed interfaces และ API

ส่วนนี้เป็น contract สำหรับ implementation ที่ต้องทดสอบ ไม่ใช่ route ที่สร้างแล้ว:

```text
POST /api/providers/reorder
  ordered IDs + expected revisions (provider scope)
POST /api/providers/:id/models/reorder
  purpose + ordered IDs + expected revisions (complete model scope)
POST /api/providers/:id/models/:modelId/test
  expected provider/model revisions + action
POST /api/providers/:id/quota
  refresh supported provider quota; no inference
POST /api/providers/:id/models/:modelId/pricing
  bounded trusted catalog refresh
```

Model observations เป็นข้อมูลต่อ model/revision/action และ latest read view; provider health เป็น summary ที่อธิบายได้ ไม่เขียนทับทุก model ด้วยผล test ตัวเดียว. Usage logs ของ runtime แยกจาก probes และไม่ inflate AI-resolution metrics. โครงสร้างเพิ่มด้วย additive migration ไม่แก้ deployed migration เก่า

## Acceptance ก่อนรับ M5/M6 ใหม่

1. PRV-01/02: free generation + embedding, unknown/paid rejection, free429→next free, paid HTTP=0, no guessed dimensions, safe abort/body/network and no open SQL transaction
2. PRV-03: reorder provider/model จาก browser → reload → actual gateway order; atomic failure/concurrent conflict; purpose isolation; nonadmin denial; fallback preview ตรง backend
3. PRV-04: test selected model fail ไม่ถูก fallback ซ่อน; HTTP200/429/401/403/402/5xx/timeout/invalid output + UNKNOWN/shared/near/exhausted quota มี evidence; stale response ไม่ overwrite config ใหม่
4. Browser desktop/mobile, keyboard, zoom, long IDs/Thai text, loading/empty/error และ minimal hierarchy; visual QA ยัง pending
5. PRV-05: signed configured free RAG harness, regressions, PG/RLS/typecheck/lint/build และ live-free/manual acceptance แยกสถานะตามจริง

Acceptance IDs รายละเอียดอยู่ใน [matrix](../requirements/V1_REQUIREMENTS_MATRIX.md) และ [board](../tasks/V1_TASK_BOARD.md); ห้ามกลับ M7 จน PRV prerequisite/automated gates ผ่าน
