# ทดสอบ LINE Staff OA webhook

ขอบเขตนี้เป็น text echo สำหรับ Staff OA เท่านั้น ใช้ Staff secret ตรวจ raw-body HMAC-SHA256 ก่อน parse JSON แล้วใช้ replyToken ของ event ส่งคำตอบผ่าน LINE Reply API ไม่มี AI/RAG/Supabase/Ticket/staff notifications ใน endpoint นี้ Student webhook และตัวตรวจลายเซ็นเดิมไม่ได้เปลี่ยน

## สิ่งที่คุณตั้งค่าใน LINE Developers

1. เปิด Messaging API channel ของ OA **YRU Staff Support**
2. ใส่ Webhook URL นี้:

```text
https://outstanding-division-added-hats.trycloudflare.com/api/line/staff/webhook
```

3. กด **Verify** ต้องขึ้น Success และเปิด **Use webhook**
4. ส่งข้อความใหม่ว่า **สวัสดี** เข้าแชต **YRU Staff Support**
5. ต้องได้รับคำตอบตรงตามนี้:

```text
Staff webhook received: สวัสดี
```

Path ของ Staff คือ `/api/line/staff/webhook` ส่วน Student ใช้ `/api/line/student/webhook` ตามเดิม ค่า `LINE_STAFF_CHANNEL_SECRET` และ `LINE_STAFF_CHANNEL_ACCESS_TOKEN` ตั้งไว้ใน `.env` แล้ว; ค่าทั้งสองต้องเป็นของ Staff channel ตาม [การตรวจ signature ของ LINE](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)

URL ปัจจุบันเป็น tunnel ชั่วคราว ต้องเปิด Next.js ที่ port3000 และ cloudflared ต่อไว้ หากเริ่ม tunnel ใหม่ด้วย URL ใหม่ ให้อัปเดต Webhook URL ใน LINE Developers แล้ว Verify อีกครั้ง

## อ่าน log

```text
Verified LINE staff webhook: { eventCount: 1 }
LINE staff reply sent: { status: 200, eventIndex: 0 }
POST /api/line/staff/webhook 200
```

บรรทัดแรกยืนยันว่า raw-body signature ผ่านและรับ1event บรรทัดที่สองยืนยันว่า LINE Reply API รับคำขอส่งสำเร็จ บรรทัดสุดท้ายยืนยันว่า server ตอบรับ webhook แล้ว ตรวจคำตอบในแชตจริงอีกครั้งเพื่อยืนยันปลายทาง `events: []` จาก Verify จะมี eventCount0 และไม่มีการเรียก Reply API

Staff log แสดงจำนวน event, index, status และ error code เท่านั้น ไม่พิมพ์ payload หรือข้อความดิบ จึงไม่เผย secret/access token/replyToken หรือ LINE routing identifiers Server ที่ Codex เปิดไว้ทำงานใน execution session10921; terminal ใหม่ไม่ได้รับ stdout ของ process นี้โดยอัตโนมัติ

## Error codes

| Code/status | ความหมาย |
|---|---|
| `LINE_STAFF_CHANNEL_SECRET_NOT_CONFIGURED` /503 | ยังไม่มี Staff secret |
| `INVALID_LINE_SIGNATURE` /401 | ลายเซ็นไม่ถูกต้อง, raw body เปลี่ยน หรือใช้ secret ผิด channel |
| `INVALID_JSON` /400 | signature ผ่านแล้วแต่ JSON ไม่ถูกต้อง |
| `INVALID_WEBHOOK_PAYLOAD` /400 | JSON ไม่มี events array ที่ถูกต้อง |
| `LINE_STAFF_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED` | ไม่มี Staff token; valid webhook ยังตอบ200 |
| `LINE_REPLY_API_ERROR` พร้อม status | LINE ไม่รับคำขอ;400อาจเกิดจาก replyToken ใช้แล้ว/หมดอายุ,401จาก token,429จาก rate limit |
| `LINE_REPLY_NETWORK_ERROR` | network/timeout ภายใน5วินาที |
| `LINE_REPLY_TEXT_TOO_LONG` | echo ต้องใช้เกิน5ข้อความ จึงข้ามการส่ง |

ภาพ, follow, postback และ event ที่ข้อมูลไม่ครบจะถูกข้ามอย่างปลอดภัย ข้อความสั้นตอบเป็น bubble เดียว; ข้อความยาวแบ่งเป็นช่วงละไม่เกิน5,000 UTF-16 units โดยไม่ตัดคู่ surrogate ของอีโมจิ ตาม [ข้อจำกัด LINE Reply API](https://developers.line.biz/en/reference/messaging-api/#send-reply-message) และ [วิธีนับตัวอักษร](https://developers.line.biz/en/docs/messaging-api/text-character-count/) การทดสอบนี้ไม่มี retry/outbox หาก Reply API ล้มเหลวจะ log เฉพาะ fixed code/status และตอบ webhook200

## ไฟล์และการตรวจ

- `app/api/line/staff/webhook/route.ts`: raw-body verification และ events envelope
- `lib/line/staff-echo.ts`: text-only reply, timeout และ error codes
- `tests/staff-webhook-route.test.ts`:18behavioral tests รวมแยก credentials ของ Staff/Student
- `scripts/line/smoke-staff-webhook.mjs`: public/local HTTP smoke ที่ไม่ส่งข้อความจริง

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node scripts/line/smoke-staff-webhook.mjs https://outstanding-division-added-hats.trycloudflare.com
```

หยุดที่ Staff OA webhook test ตามคำสั่งผู้ใช้
