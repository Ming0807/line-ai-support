# ผลทดสอบ Student OA text echo — 4 ตุลาคม 2569

ผล: **ผ่าน end-to-end** สำหรับข้อความทดสอบที่ผู้ใช้ส่งจริง

ผู้ใช้ส่ง **สวัสดี** เข้า OA **YRU AI Support** หลังติดตั้งโค้ดใหม่ และยืนยันว่าได้รับคำตอบตรงตามนี้:

> ได้รับข้อความแล้วครับ: สวัสดี

## หลักฐาน server

Execution session10921 รับ webhook จริงจาก LINE: text “สวัสดี”, signature ผ่าน, replyToken และ routing identifiers ถูกปิดค่าใน log จากนั้นพบ:

```text
LINE student reply sent: { status: 200, eventIndex: 0 }
POST /api/line/student/webhook 200 in 500ms
```

สถานะ200ของ Reply API เป็นหลักฐานว่า LINE รับคำขอ และคำยืนยันของผู้ใช้เป็นหลักฐานว่าคำตอบปรากฏในแชตจริง ไม่มี credential/token จริงในรายงานนี้

## การตรวจอัตโนมัติ

- RED: ก่อนเพิ่ม reply logic มี6behavioral tests ที่ fail เพราะไม่มีการเรียก LINE/ไม่มี fixed error codes/ยังไม่ตรวจ events array
- การตรวจโค้ดพบว่าการเติม prefix อาจทำให้ข้อความยาวเกินข้อจำกัด LINE; เพิ่ม3regression tests แล้วเห็น RED ก่อนแก้ จากนั้นแบ่ง echo โดยรักษาข้อความเดิมและคู่ surrogate ของอีโมจิ
- GREEN:16route tests ผ่าน ครอบคลุม exact Thai echo, raw-body signature ก่อนJSON, signature ผิดไม่เรียก LINE, events[]ไม่ใช้ access token, malformed/non-text siblings, missing token, API401, network exception, log ไม่เผย credential, ข้อความยาวและอีโมจิที่รอยต่อ
- Full unit suite41/41 ผ่าน (6files), exit0 หลังแก้กรณีข้อความยาว
- `pnpm typecheck`, `pnpm lint`, `pnpm build` ผ่านทั้งหมดหลังแก้ล่าสุด; build session47875 exit0
- HTTPผ่าน public HTTPS: signed events[]200, raw body ที่แก้ไข401, ไม่มี signature401, GET405
- Read-only LINE bot-info probeได้200 และแสดงชื่อ OA YRU AI Support

## ไฟล์หลัก

- `app/api/line/student/webhook/route.ts`
- `lib/line/student-echo.ts`
- `tests/student-webhook-route.test.ts`
- วิธีทดสอบและอ่าน log: `docs/learning/LINE_ECHO_TEST.md`

`lib/line/signature.ts` ไม่ได้เปลี่ยน การตอบนี้เป็น echo test ไม่มี AI/RAG/Supabase/tickets/router/staffใน endpoint และหยุดการพัฒนา Phaseอื่นตามคำสั่งผู้ใช้

## ข้อจำกัดของผล

พิสูจน์ flow ของข้อความ text ทดสอบนี้แล้ว URL เป็น tunnelชั่วคราวที่ต้องเปิดพร้อมserver การทดสอบนี้ไม่มี retry/outbox; หาก LINE API ล้มเหลวจะบันทึกเฉพาะ code/status และตอบ webhook200ตามข้อกำหนด

ข้อความสั้นรวม “สวัสดี” ตอบเป็นข้อความเดียวตามกำหนด ข้อความยาวแบ่งเป็นข้อความละไม่เกิน5,000 UTF-16 units และรักษาเนื้อหาเมื่ออ่านต่อกัน; หาก echo ต้องใช้เกิน5ข้อความจะข้ามและ log `LINE_REPLY_TEXT_TOO_LONG` ตาม [ข้อจำกัด LINE Reply API](https://developers.line.biz/en/reference/messaging-api/#send-reply-message) และ [วิธีนับความยาวข้อความ](https://developers.line.biz/en/docs/messaging-api/text-character-count/) กรณีขอบเขตเหล่านี้ตรวจด้วย mocks ยังไม่ได้ส่งข้อความยาวจริงเข้า OA
