# ตั้งค่า LINE student webhook ขั้นแรก

อัปเดต: ผู้ใช้ Verify และส่ง “สวัสดี” เข้ามาสำเร็จแล้ว ขณะนี้เพิ่มการทดสอบตอบกลับข้อความตามคำสั่งใหม่ ดู `docs/learning/LINE_ECHO_TEST.md` ส่วนขั้นตอนด้านล่างอธิบายจุดเริ่มต้นของ webhook

Webhook คือ URL ที่ LINE ส่งข้อมูลมาเมื่อมีคนส่งข้อความให้ LINE OA ของเรา ระบบรับข้อมูลดิบ → ตรวจลายเซ็นด้วย Channel Secret → อ่าน JSON → แสดง payload ใน log → ตอบ HTTP 200 เพื่อบอก LINE ว่ารับข้อมูลแล้ว

ขั้นนี้ยังไม่บันทึกฐานข้อมูล ไม่เรียก AI และไม่ส่งข้อความตอบนักศึกษา HTTP 200 เป็นคำตอบให้เซิร์ฟเวอร์ LINE ไม่ใช่ข้อความในห้องแชต

## สิ่งที่ทำให้แล้ว

- Endpoint `POST /api/line/student/webhook` ใน `app/api/line/student/webhook/route.ts`
- HMAC-SHA256 ของ raw body ก่อน `JSON.parse`; เปรียบเทียบลายเซ็นแบบ timing-safe
- `events: []` ที่ LINE ใช้ Verify ได้ HTTP 200 เช่นเดียวกับข้อความจริง
- แสดง payload ที่ตรวจผ่านแล้วใน log ชื่อ `Verified LINE webhook:` โดยปิดค่า LINE identifiers/reply token
- LINE endpoint ไม่ต้องผ่านการตรวจ session ของ Supabase
- `.env` มี `LINE_STUDENT_CHANNEL_SECRET` แล้ว และใช้ทดสอบ request จำลองผ่านทั้ง localhost และ HTTPS สำเร็จ

## สิ่งที่คุณต้องทำในบัญชี LINE

1. ถ้ายังไม่มี Messaging API channel: สร้างหรือเลือก LINE OA ใน [LINE Official Account Manager](https://manager.line.biz/) แล้วเปิด Messaging API ให้ OA นั้น การเปิดนี้จะสร้าง channel จากนั้นเข้า [LINE Developers Console](https://developers.line.biz/console/) ด้วยบัญชีเดียวกัน [คู่มือสร้าง channel ของ LINE](https://developers.line.biz/en/docs/messaging-api/getting-started/)
2. เลือก provider และ **Messaging API channel ของ OA นักศึกษา** ตรวจว่า Channel Secret ในแท็บ **Basic settings** เป็นค่าที่ใช้ใน `.env` ชื่อ `LINE_STUDENT_CHANNEL_SECRET` ค่านี้เป็นของ LINE ไม่ใช่ Supabase key
3. ไปแท็บ **Messaging API** → **Webhook URL** → **Edit** วาง URL ด้านล่างแล้วกด **Update**

   ```text
   https://outstanding-division-added-hats.trycloudflare.com/api/line/student/webhook
   ```

4. กด **Verify** ควรได้ **Success** แล้วเปิด **Use webhook** [คู่มือตั้ง Webhook URL ของ LINE](https://developers.line.biz/en/docs/messaging-api/building-bot/)
5. สแกน QR ของ OA ในแท็บ Messaging API เพื่อเพิ่มเพื่อน แล้วส่งข้อความ เช่น `ทดสอบ webhook` ดู terminal ที่รัน Next.js จะมี `Verified LINE webhook:` และข้อความที่ส่งมา

หาก OA ตอบข้อความเองในตอนนี้ อาจเป็นข้อความตอบอัตโนมัติของ LINE OA สามารถปิด Auto-reply messages ใน LINE Official Account Manager เพื่อดูผลทดสอบได้ชัดเจน ขั้นนี้ไม่ต้องใช้ Channel access token; จะใช้เมื่อต่อส่วนส่งข้อความตอบกลับ

## URL นี้ใช้งานเมื่อใด

URL ข้างต้นเป็น Cloudflare Quick Tunnel สำหรับทดสอบ เปิดเชื่อมกับแอปที่ `http://localhost:3000` แล้ว ต้องให้แอปและ tunnel ทำงานอยู่บนเครื่องนี้ URL หยุดทำงานเมื่อปิด tunnel และการเปิด tunnel ใหม่จะได้ hostname ใหม่ [คู่มือ Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

หากต้องเปิดใหม่ ใช้ PowerShell สอง terminal จาก `D:\project-next\line-ai-yru`:

```powershell
pnpm dev --port 3000
```

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://localhost:3000 --protocol http2
```

นำ HTTPS URL ที่คำสั่ง tunnel แสดงมาต่อท้าย `/api/line/student/webhook` แล้วอัปเดต Webhook URL ใน LINE อีกครั้ง

## ตรวจผลและแก้ปัญหา

| ผล | ความหมาย | วิธีตรวจ |
|---|---|---|
| 200 | รับและตรวจลายเซ็นผ่านแล้ว รวมถึง `events: []` | เมื่อ Verify ใน LINE ควรได้ Success |
| 401 | ไม่มีลายเซ็นหรือลายเซ็นไม่ตรง | ตรวจ Channel Secret ว่ามาจาก channel เดียวกัน; restart แอปหลังแก้ `.env` |
| 400 | ลายเซ็นผ่าน แต่ JSON ไม่ถูกต้อง | ใช้ payload จาก LINE หรือ request จำลองที่เป็น JSON |
| 503 | ยังไม่ได้ตั้ง Channel Secret | ใส่ `LINE_STUDENT_CHANNEL_SECRET` ใน `.env` แล้ว restart แอป |
| 405 | ส่ง GET เช่นเปิด URL ใน browser | LINE ใช้ POST; ใช้ปุ่ม Verify เพื่อทดสอบ |
| 502 / ติดต่อไม่ได้ | แอปหรือ tunnel หยุดแล้ว | เปิดทั้งสอง process และตรวจ URL ที่ได้ล่าสุด |

ทดสอบ HTTP ด้วย request จำลองที่เซ็นด้วยค่าใน `.env` โดยไม่แสดง secret:

```powershell
node scripts/line/smoke-webhook.mjs
node scripts/line/smoke-webhook.mjs https://outstanding-division-added-hats.trycloudflare.com
```

ผลที่คาดหวัง: signed `events: []` → 200, raw body ที่แก้ไข → 401, ไม่มี signature → 401, GET → 405

บทเรียนพร้อมตัวอย่างลายเซ็นอยู่ใน `docs/learning/lessons/0001-line-webhook.html`
