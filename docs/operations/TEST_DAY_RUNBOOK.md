# Runbook วันทดสอบจริง (Flow A–F) — พร้อมแบบบันทึกผล

จัดทำ 25 ต.ค. 2026 ใช้คู่กับ [คำถาม-คำตอบที่คาดหวัง](LIVE_TEST_QA_PREP.md) และ [checklist หลัก](FINAL_SETUP_CHECKLIST.md) — ออกแบบให้ทำจบใน 1 เซสชัน (~1–2 ชม.)

## ก่อนวันทดสอบ (เช็ค 5 นาที)

- [ ] เครื่องเปิด Docker (Supabase ขึ้น) · Node 24 · `.env` อยู่ครบ
- [ ] โทรศัทร์มี LINE Student OA + Staff OA 2 บัญชี (Staff 2 คนถ้าทดสอบแย่งเคส)
- [ ] เข้า [LINE Developers](https://developers.line.biz) ได้ (จะต้อง copy webhook URL)

## ขั้นตอนวันทดสอบ

1. **เปิดระบบ:** PowerShell → `pnpm local:ai` → รอ **READY** → *คัดลอก Student/Staff webhook URL จากหน้าจอทันที* (quick tunnel เปลี่ยน URL ทุกครั้งที่เปิดใหม่) — ห้ามปิด terminal (ดู log ระหว่างทดสอบ)
2. **ตั้ง webhook:** LINE Developers → แต่ละ OA → Messaging API → วาง URL ที่ตรงกับ OA นั้น → กด Verify ให้ได้ 200 → เปิด Use webhook → **ปิด auto-reply ของ OA** (กันตอบซ้ำ)
3. **ผูก Staff:** Dashboard login → Settings → สร้าง binding code → ส่งให้ Staff OA ภายใน 10 นาที → เช็คสถานะ binding + แผนก
4. **ไล่ทดสอบตามลำดับใน [LIVE_TEST_QA_PREP](LIVE_TEST_QA_PREP.md):** ชุด 1 (เอกสารจริง A1–A8) → ชุด 2 (ไม่มีเอกสาร B1–B3) → ชุด 3 (troubleshooting→ticket) → ชุด 4 (HUMAN/หลายเคส) → ชุด 5 (ทั่วไป) → ชุด 6 (Import รุ่นใหม่ ทำบน Dashboard)
5. **จบวัน:** Ctrl+C หรือ `pnpm local:stop` — หยุดเฉพาะ session ของเรา

## กฎการเก็บหลักฐาน

- จดทุกผลที่**ไม่ตรง**ตามตารางด้านล่าง (ผลตรงไม่ต้องจดทุกข้อ แค่เช็ค ✓)
- ห้ามใส่รหัสผ่าน/ข้อมูลส่วนตัวจริงในแชตและในแบบบันทึก
- ถ้าระบบเงียบ: จดเวลา + ดู log ใน terminal บรรทัดสุดท้ายก่อนเงียบ

## แบบบันทึกผล (เติมเฉพาะข้อที่พัง/น่าสงสัย)

| # | เวลา | รหัสเคส/anon | ชุด-ข้อ | ที่คาดหวัง | ที่ได้จริง | log บรรทัดสุดท้าย |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

> ส่งกลับมาใน chat ได้เลย — ทุกแถวจะกลายเป็นงานแก้ (RED) ของ agent ทันที
