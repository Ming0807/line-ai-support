# Worksheet เลือก Host + เตรียมวัน Deploy

จัดทำ 25 ต.ค. 2026 ย่อจาก [production runbook](PRODUCTION_RUNBOOK.md) — ใช้ตอนคุณพร้อมเลือก host/domain และผู้ดูแล backup

## ส่วน A — เลือก Host (เช็คลิสต์ความต้องการ)

| หัวข้อ | ที่ระบบต้องการ | ที่ host คุณมี? |
|---|---|---|
| CPU/RAM | Node 24 + parser child + E5 CPU (แนะนำ ≥2 vCPU / ≥4 GB RAM เริ่มต้น) | □ |
| ระยะกันที่ | ดิสก์ ≥10 GB (E5 cache ~500MB + originals + DB ภายนอก) | □ |
| Node.js | เวอร์ชัน 24+ (tsx + parse5/pdf-parse ใน package เดียว) | □ |
| เครือข่าย | ออกอินเทอร์เน็ตได้ (Gemini API + Supabase) · TLS domain เสถียร (แทน quick tunnel) | □ |
| ระบบเฝ้าระวัง | process manager (systemd/PM2/Docker) สำหรับ web + workers 4 ตัว + restart เมื่อล้ม | □ |
| Backup | ผู้รับผิดชอบ + ตารางสำรอง DB (Supabase) + knowledge-originals bucket | □ |
| ความเป็นส่วนตัว | `.env`/keys ผ่าน secret config เท่านั้น · access log เข้าถึงได้เฉพาะแอดมิน | □ |

> ทางเลือกยอดนิยม: VPS เอง / Supabase + Vercel-style PaaS (ต้องยืนยันว่ารัน worker แยกได้) — **worker 4 ตัวต้องรันเป็น process ต่อเนื่อง** ไม่ใช่ serverless

## ส่วน B — เตรียมก่อนวัน Deploy

- [ ] เลือก domain + ออกใบ TLS (เช่นผ่าน reverse proxy)
- [ ] สร้าง Supabase **production project** แยกจาก development + ตั้ง credentials ใหม่ทั้งชุด (ห้ามใช้ key เดิม)
- [ ] ย้าย E5 cache: คัดลอก `services/embedding` + cache เดิม (offline, ห้ามโหลดน้ำหนักใหม่) + ทดสอบ health 200
- [ ] สร้าง bucket `knowledge-originals` (private, limit ~20MB, octet-stream, ไม่มี public policy)
- [ ] วางแผน migration: รัน migrations 43 ตัวบน production DB + advisors (0 ERROR/0 WARN)
- [ ] กำหนดผู้ดูแล backup: ตารางสำรอง + **ซ้อม restore จริง 1 ครั้งก่อนเปิดใช้**
- [ ] เตรียมบัญชี Staff production + ตรวจ role/แผนก
- [ ] ตั้ง webhook URL ถาวรใน LINE Developers ทั้งสอง OA

## ส่วน C — เช็คลิสต์วัน Deploy (ย่อ)

1. ติดตั้ง deps (`pnpm install --frozen-lockfile`) → `pnpm build` → ตรวจ 0 error
2. ตั้ง secrets → `pnpm local:check` ผ่านบน host จริง (43 migrations, RLS, 1 enabled model)
3. เริ่ม web + workers 4 ตัวผ่าน process manager → ตรวจ check-in ครบ
4. ทดสอบ webhook ทั้งสอง: signed 200 / invalid 401
5. `GENERATION_TEST` จาก Providers UI → 200 ภายใน ~25 วิ
6. ทดสอบ Flow A–F อีกรอบสั้นๆ บน production
7. ตั้งแจ้งเตือน/monitoring (log rotate + แจ้งเมื่อ worker ตาย) + บันทึกวันที่ deploy ใน decision log

## ส่วน D — เมื่อถึงเฟส provider/local AI ภายหลัง (ตาม DEC-165)

ใช้ [PROVIDER_ONBOARDING_PLAYBOOK](PROVIDER_ONBOARDING_PLAYBOOK.md) — host ที่เลือกวันนี้ควรเผื่อทรัพยากรไว้ (ดูขนาดแนะนำใน playbook ส่วน Local AI)
