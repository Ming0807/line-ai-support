# Provider management — Product minimal brief

สถานะ: **UI component implemented and browser verified; final provider acceptance pending**. อิงคำขอผู้ใช้, [PRODUCT](../../PRODUCT.md), [DESIGN baseline](../../DESIGN.md) และ [provider behavior](../architecture/AI_PROVIDER_DESIGN.md). ใช้ guidance จาก skill `impeccable` ในโหมด **Operate**: scanability/consistency สำคัญกว่าการตกแต่ง. [5Oct evidence](../reports/PRV_OBSERVATIONS_COMPONENT_REPORT.md) ระบุ actual browser/screenshots/fixture scope และ cooldown/compatible gaps

## งานและผู้ใช้

Super Admin ต้องเลือก AI ที่ใช้ได้จริงและฟรี จัดลำดับ fallback ตรวจว่า model ใดมีปัญหา และทดสอบแต่ละ model โดยไม่แก้โค้ด ผู้ใช้สำเร็จเมื่ออ่าน fallback order ตรง backend, เห็นเหตุที่ model ถูกข้าม และแก้ configuration ได้จากหน้าเดียว

## โครงหน้า

1. หัวหน้า “ผู้ให้บริการ AI” กับ action “เพิ่มผู้ให้บริการ”; policy “ใช้เฉพาะโมเดลฟรี” เห็นได้แต่ไม่เป็น banner ใหญ่
2. Latest human update5October: normal page shows generation/reasoning only; no Embedding tab/purpose/dimension controls. Read-only Embedding Service shows E5/384/Local/observed health/time, no endpoint/cache/key. Internal legacy purpose-aware ordering remains; no normal embedding registry entry required
3. Provider group มีชื่อ เปิด/ปิด, quota ที่แชร์, ปุ่มขึ้น/ลงและ “ตั้งค่า”; base URL/key/config ยาวอยู่ในรายละเอียด
4. Model rows: ชื่อ/ID → free/paid/unknown → HTTP/status/เวลาตรวจ → quota พร้อม scope → ขึ้น/ลง → “ทดสอบ” → เมนูแก้ไข
5. “ลำดับที่ระบบจะใช้” แสดง candidate order จริงและเหตุที่ excluded; form เพิ่ม/แก้เปิดเฉพาะเมื่อใช้งาน

FREE/PAID/UNKNOWN แสดงตาม catalog provenance/purpose/check time ของ configปัจจุบัน ไม่ใช้manualpriceเป็นproof. ราคา/ผลตรวจ stale หรือunsupported แสดง UNKNOWN/เวลาและเหตุที่ยังtestไม่ได้. Quotaแสดงscope/unit/window/source/เวลาที่ตรวจ; ไม่มีremaining evidenceไม่ทำmeterขึ้นเอง. ใกล้หมดใช้warningpolicyในproviderdesign ไม่ใช่providerclaimใหม่

Concept ตัวอย่างด้านล่างเป็น fixture ของการออกแบบ ไม่ใช่ผล live test:

```text
ผู้ให้บริการ AI                         [เพิ่มผู้ให้บริการ]
ใช้เฉพาะโมเดลฟรี
[Embedding Service: E5 / 384 / Local / observed health — read only]
[ผู้ให้บริการและ Models สำหรับสร้างคำตอบ]

OpenCode Zen                       [ขึ้น] [ลง] [ตั้งค่า]
ลำดับ 1 · โควต้า: ยังไม่ทราบ
Model A    ฟรี    200 · ทดสอบผ่าน    —    ↑ ↓ [ทดสอบ] ⋯
Model B    ฟรี    429 · จำกัดคำขอ    —    ↑ ↓ [ทดสอบ] ⋯

OpenRouter                         [ขึ้น] [ลง] [ตั้งค่า]
ลำดับ 2 · โควต้าร่วมของคีย์: 8/50 · ใกล้ถึงขีดจำกัด
Model C    ฟรี    ยังไม่ทดสอบ       ร่วมกับ Provider  ↑ ↓ [ทดสอบ] ⋯

ลำดับที่ระบบจะใช้: Model A → Model C
```

ตัวเลข 8/50 เป็น mock layout เท่านั้น ห้าม seed ลง runtime; Model B ถูกข้ามใน preview เฉพาะเมื่อมี cooldown ที่ยังไม่หมดตาม observation จริง

## Interaction

- ขึ้น/ลงขยับหนึ่งตำแหน่งใน scope เดียวกัน ปุ่มแรก/สุดท้าย disabled. แสดง draft order แล้ว “บันทึกลำดับ”/“ยกเลิก”; บันทึก batch เดียว ไม่ยิง N requests ที่ทำให้ลำดับเปลี่ยนครึ่งเดียว
- Drag-and-drop เป็น optional enhancement; ขึ้น/ลงต้องใช้ได้เองทั้ง keyboard/mobile. Focus อยู่ที่ model ที่ขยับ พร้อม announcement; ไม่ต้อง drag ถึงจะจัดลำดับได้
- “ตรวจการเชื่อมต่อ” ตรวจ metadata; “ทดสอบ Model” ทำ bounded fixed-prompt generation/embedding เฉพาะตัวที่กด ไม่มี fallback ซ่อน. Test ต้องผ่าน FREE_ONLY และไม่เปิด model อัตโนมัติ
- ผล test แสดงเวลา, HTTP, error code ที่ปลอดภัย, latency และ application validation. Details เปิดเพิ่มได้ ไม่เท raw provider response ลงหน้า
- API conflict เก็บคำอธิบาย/ให้ reload; ไม่แสดง success เมื่อ save ไม่ผ่าน. สถานะไม่สลับเองจาก response เก่าหลังผู้ใช้แก้ key/model

Provider orderเป็นglobalชั้นแรก จึงมีผลทั้งสองtabs; Model orderอยู่ในprovider+purpose. Previewใช้ providerPriority→modelPriority→stableID และ eligibilityเดียวกับgateway. UIไม่sortด้วยdisplaynameแล้วอ้างว่าruntimeorderเหมือนกัน. Zen/OpenRouter/protocolsetupต้องทำPRV-02ก่อนแสดงว่าเพิ่มและใช้ได้จริง

Accessible controlsมีชื่อเช่น “เลื่อน Model A ขึ้นหนึ่งลำดับ”/“เลื่อน OpenRouter ลงหนึ่งลำดับ”; หลังmove focusตามrowเดิมและlive regionประกาศตำแหน่งใหม่. Touch targetsบนmobileไม่น้อยกว่า44px; keyboardไม่ใช้drag. จัดphoneเป็นidentity/statusก่อน quota scopeและactionsที่กดได้ ส่วนURL/capability/pricesยาวอยู่details

## States และความหนาแน่น

ไม่มี provider → แนะนำเพิ่ม Zen/OpenRouter; ไม่มี key/model → แสดงขั้นตอนที่ขาด; catalog UNKNOWN → ปิด inference test พร้อมเหตุผล; pending test → disable เฉพาะ row ที่กำลังทดสอบ; stale observation → บอกเวลา; empty/error/loading มีข้อความและ action ที่กลับมาทำงานต่อได้

ใช้ grouping และ search เมื่อรายการยาว; ไม่กำหนด hard UI limit จากการเดาจำนวน model. Model ID ยาว/ภาษาไทย/ตัวเลขใหญ่ต้องไม่ดัน action ออกนอก viewport. Mobile ให้ identity/status อยู่ก่อน quota/actions ส่วนรายละเอียดอยู่ใน expandable area

Recoveryที่ต้องมี: listloadfail→ปุ่มลองใหม่; missingkey→ตั้งค่าprovider; nomodel→เพิ่มmodel; pricingunknown→refreshmetadataพร้อมreason; HTTP401/403→ตรวจkey/สิทธิ์; 429→แสดงretrytimeถ้ามี; 409save/test→โหลดrevisionล่าสุดโดยไม่รายงานsuccess. Testหนึ่งrowไม่blockการอ่าน/แก้rowอื่น

## ขอบเขตและวิธีตรวจ

PRV-03/04 ทำ Provider surface ตามนี้และใช้ tokens เดิม ไม่ redesign login/tickets ในงานเดียวกัน. Design system ใช้ต่อกับ Knowledge/Incidents เมื่อถึง phase ของตน

ตรวจ functional/browser: reorder persistence → reload → actual gateway order, test 200/429/401/403/5xx/timeout/invalid output, near quota with evidence, UNKNOWN without evidence, cross-role denial, 409 conflict. Desktop/mobile/keyboard/zoom screenshots and functional evidence now exist in [provider acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md); use scoped implementation evidence rather than old planning assertions. Existing impeccable cosmetic rounds are complete; further QA is for functional changes/material defects.

Compatible provider settings use a custom HTTPS URL input with fixed supported protocol and UNKNOWN-price explanation; FREE_ONLY stays default. Endpoint/platform edits need replacement key. Official provider roots remain fixed choices. Durable cooldown shows its actual expiry/countdown; no automatic inference polling. Live account/model quality remains pending.
