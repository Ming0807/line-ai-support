# Mission: เข้าใจ LINE webhook เพื่อพัฒนา YRU Helpdesk

## Why

ผู้ใช้กำลังสร้าง AI Student Support ตามคู่มือและต้องการเข้าใจคำสั่งที่ GPT ให้เรื่อง endpoint รับข้อความ LINE เพื่ออ่านโค้ดและติดตามการพัฒนาระบบได้เอง

## Success looks like

- อธิบายเส้นทาง LINE → POST → ตรวจลายเซ็น → อ่าน JSON → HTTP 200 ได้
- แยก LINE Channel Secret จาก Supabase key และ SSH public key ได้
- เข้าใจว่าทำไม events: [] เป็นคำขอทดสอบที่ถูกต้อง

## Constraints

- สอนภาษาไทย เริ่มจากตัวอย่างรับข้อความที่ไม่มี AI/ฐานข้อมูล
- ใช้ค่าและข้อความจำลองในบทเรียน ไม่ใส่ secrets จริง
- โค้ดโปรเจกต์ยังดำเนินตาม roadmap; ตัวอย่างบทเรียนแยกจาก endpoint ที่ใช้งานจริง
