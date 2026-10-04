# ผลทดสอบ Staff OA text echo — 4 ตุลาคม 2569

ผล: **ผ่าน end-to-end** ผู้ใช้ส่ง “สวัสดี” เข้า **YRU Staff Support** และยืนยันว่าได้รับ **Staff webhook received: สวัสดี** ตรงตามกำหนด Server รับ webhook จริง ตรวจ signature และส่ง reply สำเร็จ

## หลักฐาน server

Execution session10921 พบ Verify จาก LINE (eventCount0, POST200) และ event ใหม่1รายการ ตามด้วย:

```text
Verified LINE staff webhook: { eventCount: 1 }
LINE staff reply sent: { status: 200, eventIndex: 0 }
POST /api/line/staff/webhook 200 in 491ms
```

Staff log ไม่พิมพ์ payload/ข้อความดิบ/token จึงยืนยันจำนวน event และสถานะการส่งได้จาก log ผู้ใช้ยืนยันข้อความที่ส่งและคำตอบที่ได้รับในแชตจริงแล้ว จึงมีหลักฐานปลายทางเพิ่มเติมจากสถานะ API200

## การตรวจอัตโนมัติ

- RED:18Staff tests fail ด้วย status501 ก่อนเพิ่ม implementation จริง
- GREEN:18Staff tests ผ่าน ครอบคลุม exact echo, verification ว่าง, raw-body HMAC ก่อน parse, whitespace/escaped Unicode, Staff-only credentials, Student signature ที่ผิด channel, unsupported/malformed events, missing configuration, API/network failures, safe logs และข้อความยาว/emoji boundaries
- Full suite59/59 ผ่าน (7files) รวม Student regression16cases
- `pnpm typecheck`, `pnpm lint`, `pnpm build` ผ่านทั้งหมด exit0 หลังเพิ่ม Staff route; build แสดงทั้ง Staff และ Student webhook routes
- Public HTTPS Staff smoke: signed events[]200, modified raw body401, missing signature401, Student signatureที่Staff401,GET405
- Public HTTPS Student regression smoke: signed events[]200, modified raw body401, missing signature401,GET405
- Read-only LINE bot-infoได้200 และชื่อ OA **YRU Staff Support** โดยไม่พิมพ์ token/routing identifiers
- Diff จาก HEAD ของ Student route, Student helper, signature helper และ Student tests เป็นศูนย์
- Independent review: spec PASS และ code quality PASS ไม่มี actionable findings (`.superpowers/sdd/reports/staff-line-echo-review.md`)

## Manual test

Webhook URL:

```text
https://outstanding-division-added-hats.trycloudflare.com/api/line/staff/webhook
```

Manual test เสร็จแล้ว: ผู้ใช้ตั้ง URL ใน Staff channel, Verify และส่ง **สวัสดี** เข้า **YRU Staff Support** พร้อมยืนยันว่าได้รับ **Staff webhook received: สวัสดี** หากต้องการลองซ้ำ ให้ส่งข้อความใหม่ขณะserverและtunnelยังเปิดอยู่

## ขอบเขตและข้อจำกัด

มีเฉพาะ text echo ไม่มี AI/RAG/Supabase/Ticket/staff notifications ไม่มี retry/outbox การแบ่งข้อความยาวและ failure cases ตรวจด้วย mocks ส่วน server log ด้านบนมาจาก webhook จริง URL เป็น tunnelชั่วคราวที่ต้องเปิดพร้อมserver หยุดงานที่ Staff webhook test และคง full V1 goal ไว้สถานะpaused
