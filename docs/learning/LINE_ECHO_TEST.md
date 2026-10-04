# ทดสอบ LINE Student OA รับข้อความและตอบกลับ

ขอบเขตนี้เป็นการทดสอบ text echo เท่านั้น: ตรวจลายเซ็นด้วย raw body เดิม → ตรวจรูปแบบ events → ใช้ replyToken ของข้อความเพื่อเรียก LINE Reply API → ตอบรับ webhook ด้วย HTTP200 ไม่มี AI/RAG/Supabase/Ticket/router/staff ในเส้นทางนี้

## ทดสอบเองใน LINE

1. เปิดแชต **YRU AI Support**
2. ส่งข้อความใหม่ว่า **สวัสดี** หลังติดตั้งโค้ดตอบกลับแล้ว
3. ต้องได้รับคำตอบตรงตามนี้: **ได้รับข้อความแล้วครับ: สวัสดี**

ข้อความที่ส่งก่อนติดตั้งโค้ดนี้ต้องส่งใหม่ เพราะ replyToken มีอายุจำกัดและใช้ได้ครั้งเดียว ตาม [LINE Reply API](https://developers.line.biz/en/reference/messaging-api/#send-reply-message)

URL ที่ใช้อยู่:

```text
https://outstanding-division-added-hats.trycloudflare.com/api/line/student/webhook
```

แอป Next.js ที่ port3000 และ Cloudflare tunnel ต้องเปิดอยู่ หากสร้าง tunnel ใหม่ ให้อัปเดต URL ใน LINE Developers แล้ว Verify อีกครั้ง

## อ่าน log

- `Verified LINE webhook:` — รับข้อมูลและตรวจลายเซ็นผ่านแล้ว; ดู `message.text` เพื่อเทียบกับข้อความที่ส่ง
- `LINE student reply sent: { status: 200, eventIndex: 0 }` — LINE Reply API รับคำขอส่งสำเร็จ; ตรวจคำตอบในแชตอีกครั้งเพื่อยืนยันปลายทาง
- `POST /api/line/student/webhook 200` — server ตอบรับ LINE webhook แล้ว

Server ที่ Codex เริ่มไว้ทำงานใน execution session ของ Codex จึงอ่าน log ผ่าน session นั้นได้ ส่วน terminal ใหม่ของคุณจะไม่แสดง stdout ของ process เดิมโดยอัตโนมัติ ให้ Codex ตรวจ log ให้ หรือเมื่อจะรันเอง ให้หยุด server เดิมก่อนและรัน `pnpm dev --port 3000` ใน terminal ของคุณ

โค้ดปิดค่า replyToken, quoteToken, markAsReadToken และ LINE routing IDs ใน payload log และไม่แสดง Channel Secret/Channel Access Token ข้อมูล error จาก LINE หรือ exception จะไม่ถูกพิมพ์ทั้งก้อน

## ถ้าไม่ได้คำตอบ

| Log | ความหมาย |
|---|---|
| `LINE_STUDENT_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED` | ยังไม่มี access token สำหรับส่วนตอบกลับ; Verify ยังผ่านได้ |
| `LINE_REPLY_API_ERROR` พร้อม status401 | LINE ไม่รับ access token; ตรวจว่าใช้ token ของ Student OA นี้ |
| `LINE_REPLY_API_ERROR` พร้อม status400 | LINE ไม่รับ request เช่น replyToken ไม่ถูกต้อง/หมดอายุ/ถูกใช้แล้ว หรือข้อความเกินข้อจำกัด API; ส่งข้อความใหม่และตรวจ log |
| `LINE_REPLY_API_ERROR` พร้อม status429/5xx | LINE จำกัดคำขอหรือมีปัญหาฝั่งบริการ |
| `LINE_REPLY_NETWORK_ERROR` | network หรือ timeout ภายใน5วินาที; ไม่มีการแสดงข้อมูล credential ใน error |
| `LINE_REPLY_TEXT_TOO_LONG` | echo ต้องใช้เกิน5ข้อความ จึงข้ามการส่งและตอบรับ webhook200 |

Event ที่ไม่ใช่ text, รูปภาพ, follow/postback และ event ที่รูปแบบไม่ครบจะถูกข้ามอย่างปลอดภัย คำขอ valid รวม `events: []` ยังได้ HTTP200 แม้การตอบกลับจะล้มเหลว ไม่มีระบบ retry/outbox ในการทดสอบนี้

ข้อความสั้นตอบเป็นข้อความเดียว ถ้าการเติม prefix ทำให้ยาวเกิน5,000 UTF-16 units จะต่อข้อความเดิมใน bubble ถัดไปโดยไม่ตัดคู่ surrogate ของอีโมจิ LINE อนุญาตสูงสุด5ข้อความต่อ reply ตาม [LINE Reply API](https://developers.line.biz/en/reference/messaging-api/#send-reply-message) และนับความยาวตาม [UTF-16](https://developers.line.biz/en/docs/messaging-api/text-character-count/)

## ไฟล์และการตรวจ

- `app/api/line/student/webhook/route.ts`: signature เดิม, ตรวจ events array หลัง signature, log ที่ปิด token, รอการตอบกลับก่อน return
- `lib/line/student-echo.ts`: ตรวจ text event, ส่ง exact echo ผ่าน `POST https://api.line.me/v2/bot/message/reply`, timeout และ fixed error codes
- `tests/student-webhook-route.test.ts`: signature/raw-body, Verify ว่าง, exact echo, unsupported/malformed event, API/network failure, missing token และการไม่เผย credential ใน log

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node scripts/line/smoke-webhook.mjs https://outstanding-division-added-hats.trycloudflare.com
```

หยุดที่การทดสอบนี้ตามคำสั่งผู้ใช้; ยังไม่เชื่อม Phase อื่น
