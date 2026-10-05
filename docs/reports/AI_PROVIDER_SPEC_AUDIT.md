# ตรวจสเปค AI Provider และต้นทุนเริ่มต้น — 4 ตุลาคม 2026

## ข้อสรุป

ผู้ใช้จำถูก: ภาพรวมชุดแรกกำหนด Zen/OpenRouter, Provider management ผ่าน Dashboard และ fallback ตาม priority. การเลือก OPENAI เป็น adapter เดียวในแผน M5 เป็นการตัดสินใจของผู้พัฒนาเอง ไม่ใช่ข้อกำหนดจากผู้ใช้ และทำให้การเชื่อมต่อจริงยังไม่ตรงสเปค แม้ผลทดสอบ gateway/queue/RAG จะผ่านก็ตาม

คำยืนยันล่าสุดของผู้ใช้มีผลเหนือการตีความเดิม: **ช่วงเริ่มต้นใช้ AI ฟรีทั้งหมด โดยหลักเป็น OpenCode Zen และ OpenRouter; บริการเสียเงินให้มหาวิทยาลัยเพิ่มและเลือกเปิดผ่าน UI ภายหลัง**. หยุดงานฟีเจอร์ใหม่ระหว่างการตรวจนี้ ไม่ได้เปิด provider หรือแก้ runtime เพื่อเรียกบริการจริง

## หลักฐานต้นฉบับ

ต้นฉบับ: attachment `798b9f38-60c2-40b4-9851-0e8f8f54b0b1/ข้อความที่วาง.txt` ที่ผู้ใช้ส่งตั้งแต่ต้น

- บรรทัด767: “เพราะเป้าหมายของเราคือใช้ฟรีให้มากที่สุด”
- ข้อ32 บรรทัด1048–1074: ไม่ผูก AI เจ้าเดียว; AI Gateway → Zen/OpenRouter/Provider X; Admin เพิ่ม Provider จาก Dashboard โดยไม่ต้องแก้ Code ทุกครั้ง
- ข้อ33: Provider Name/Base URL/API Key/Enabled/Priority/Health และ model capabilities
- ข้อ34: fallback ตาม priority; ต้นฉบับมี Paid Emergency Model เป็นตัวอย่างปลายทาง ต่อมาผู้ใช้ยืนยันว่าบริการเสียเงินยังไม่เปิดในช่วงเริ่มต้น จึงห้ามนำตัวอย่างนี้มาเปิดเอง
- ข้อ42 บรรทัด1303–1309: Gateway เลือก Zen และเมื่อ Zen fail เลือก OpenRouter
- ข้อ43 บรรทัด1323–1324: Runtime AI = Zen/OpenRouter/Provider ต่าง ๆ
- ตอนท้าย: ยังไม่ล็อก generation/embedding/search model เพราะต้องเปลี่ยน provider ได้

คู่มือ `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` §§14,29–30 รองรับ registry/model/priority/fallback แต่ไม่ระบุให้ใช้ OpenAI เป็นเจ้าแรก. คำขอ milestone ภายหลังให้เริ่มหนึ่ง provider ที่ทำงานได้ ไม่ได้ยกเลิกเป้าหมายฟรีในต้นฉบับ

## เทียบกับโค้ดจริง

| จุด | สถานะจริง | ข้อสรุป |
|---|---|---|
| Dashboard provider/key/model/priority/health | ทำแล้ว และจำกัด active SUPER_ADMIN | เก็บใช้ต่อได้ |
| Generation registry | `lib/ai/provider-registry.ts` คืน OPENAI เท่านั้น | ขาด Zen/OpenRouter |
| DTO + DB provider URL | OPENAI และ api.openai.com เท่านั้น | เพิ่ม provider ตามสเปคผ่าน UI ยังไม่ได้ |
| Model ID | `types/providers.ts` และ DB ไม่อนุญาต `/` | OpenRouter slug เช่น `vendor/model:free` ถูกปฏิเสธ |
| HTTP protocol | Native OpenAI Responses adapter | Free Zen chat models ต้องมี Chat Completions adapter รองรับจริง |
| Fallback | deterministic priority/deadlines/429/5xx/usage ทำแล้ว | ไม่มี FREE_ONLY guard; ราคาที่กรอกเป็นเพียงข้อมูลคำนวณ |
| Embedding | native OpenAI adapter เท่านั้น | เส้นทาง RAG ฟรียังไม่ครบ ต้องตรวจ embedding แยกจาก generation |
| บริการเสียเงินภายหลัง | ยังจำกัด protocol/provider เดิม | ต้องขยาย compatible provider UI และ explicit cost policy |

## ตรวจผู้ให้บริการ ณ วันที่ตรวจ

- [OpenCode Zen docs](https://opencode.ai/docs/zen/): มีรุ่นฟรีและรุ่นเสียเงินแยกกัน; หลายรุ่นฟรีเป็นช่วงทดลองชั่วคราว. ใช้ชื่อ provider เพียงอย่างเดียวเพื่อรับรองว่าฟรีไม่ได้. Public models API ที่ตรวจคืนรายการแต่ไม่มีราคาบนแต่ละ model จึงห้ามตีความ `pricing=null` เป็นฟรี
- [OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free): รุ่นฟรีมี catalog entry ของตนเอง; ไม่ใช่ใส่ `:free` ให้ model ใดก็ได้. ราคา/capabilities/availability ต้องตรวจของ entry ที่เลือกจริง
- Public [generation catalog](https://openrouter.ai/api/v1/models) ที่อ่านโดยไม่ส่งคีย์:466รายการ พบ22รายการที่ระบุ prompt/completion ราคา0. ตัวเลขเป็น snapshot ไม่ใช่ค่าเริ่มต้นที่ hardcode
- Public [embedding catalog](https://openrouter.ai/api/v1/embeddings/models):33รายการ พบ3รายการ prompt ราคา0 เช่น `liquid/lfm-2.5-embedding-350m:free` และ `nvidia/nemotron-3-embed-1b:free`. ยังไม่ได้ทดสอบ inference, dimension, คุณภาพภาษาไทย หรือสิทธิ์บัญชีจริง จึงยังไม่รับรองตัวใดเป็น embedding หลัก
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits): รุ่นฟรีมี quota/rate limits. ต้องใช้ neutral response/ส่งต่อเจ้าหน้าที่เมื่อฟรีใช้ไม่ได้ทั้งหมด ไม่สลับไป paid โดยพลการ

การตรวจ catalog ทั้งหมดเป็น GET สาธารณะ ไม่มี inference, ไม่มีส่ง API key และไม่มีค่าบริการ AI

## สถานะใช้งานจริง

Read-only DEVELOPMENT audit: providers0, models0, usage observations0, approved documents0, `YRU_AI_ENABLED=false`. ไม่พบ provider ถูกเปิดจริงหรือการเรียก AI แบบเสียเงิน. ก่อนคำสั่งหยุด งาน additive migration ที่เริ่มไปแล้วจบและผ่านการตรวจ:13migrations/28applicationtables ทุกตารางRLS; real3subject rollback/privacy fixture ผ่าน. นี่เป็นโครง queue/receipt ไม่มีการเปิด provider. ไม่มี commit/push ชุดนี้ระหว่างการตรวจ

## ลำดับแก้ที่ต้องทำก่อนกลับไป Import/M7

1. ตั้ง policy ค่าเริ่มต้น FREE_ONLY สำหรับ generation, classification, import analysis และ embeddings ทั้งหมด. PAID/UNKNOWN ไม่เข้า runtime candidates. หมด quota หรือทุก free candidate ล้มเหลว → bounded clarification/handoff; ไม่มี paid fallback อัตโนมัติ
2. เพิ่ม Zen และ OpenRouter protocol adapters ที่ใช้ free models จริง: bounded Chat Completions + strict output validation/tools/usage/error/cancel; เก็บ native OpenAI adapterเป็นตัวเลือกภายหลัง
3. ขยาย schema/DTO/UI พร้อม additive migration ไม่แก้ migration ที่ deploy แล้ว. รองรับ model slug `/`, provider selector และ compatible protocol/base URL ที่ตรวจสอบฝั่ง backend; เปลี่ยน providerได้ตามสเปค
4. Dashboard แสดง FREE/PAID/UNKNOWN พร้อมหลักฐานราคา/เวลาตรวจ. Missing/stale/unknown price ไม่เท่ากับ0. มหาวิทยาลัยเพิ่ม paid key/model ได้ แต่การใช้ paid ต้องเปิด policy โดย active SUPER_ADMIN อย่างชัดเจนและมี audit
5. ต่อ free embedding path ผ่าน catalog ที่ตรวจแล้ว, explicit dimensions/fingerprint และทดสอบภาษาไทย/เอกสารจริงก่อนเลือก. รุ่นตอบคำถามฟรีไม่ได้ทำให้ embeddings ฟรีโดยอัตโนมัติ
6. RED→GREEN tests: free provider priority/fallback, free quotaหมดไม่เกิด paidHTTP, paid modelแม้ enabled ถูกกันในFREE_ONLY, unknown pricingถูกกัน, slash IDs, UI providerเปลี่ยนได้, schema privacy, no credentials/read-back. ทดสอบ RAG และ HUMAN fenceซ้ำหลังต่อ adapters
7. เปิด acceptance ของ M5/M6 ด้าน provider ใหม่จนกว่าข้อกำหนดนี้ผ่าน. ผล81PG/426unit/type/lint/buildเดิมยังเป็นหลักฐานส่วนที่ทำไว้ แต่ใช้สรุปว่าทั้งสเปค providerเสร็จแล้วไม่ได้

การตรวจนี้จบที่ข้อค้นพบและแผนแก้ ยังไม่ได้อ้างว่า Zen/OpenRouter หรือ FREE_ONLY ถูก implement แล้ว
