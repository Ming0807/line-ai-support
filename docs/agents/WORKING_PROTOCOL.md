# กติกาการทำงานตามแผน YRU

อ่าน [AGENTS](../../AGENTS.md) และ [project index](../PROJECT_INDEX.md) ก่อนรับงาน ใช้ [task board](../tasks/V1_TASK_BOARD.md) เป็นสถานะปัจจุบันร่วมกัน

## ก่อนแก้ behavior

1. เลือก task ID และ requirement IDs; อ่านต้นฉบับ section ที่เกี่ยวข้องจริง
2. ระบุ code ปัจจุบัน, gap, dependencies, files ที่แก้ และ acceptance ใน execution plan ห้ามเลือก provider/model/schema จากความคุ้นเคย
3. ถ้าแผนเก่าขัดคำสั่งล่าสุด ให้บันทึก decision/reopened status และแก้ design/plan ก่อน implementation
4. ทำ vertical slice ที่ครบทั้ง input, authorization, persistence, failure behavior, UI เมื่อเป็น requirement และ evidence ไม่ข้าม gate ไปสร้าง phase ใหม่

## ใบมอบงานที่ใช้ซ้ำ

```text
Task ID:
Requirement IDs and exact source sections:
Read: AGENTS.md, PROJECT_INDEX.md, current board, relevant design/plan
Scope and files owned:
Prerequisites/contracts to preserve:
Acceptance commands and expected behaviors:
Out of scope:
Report path:
```

Root เป็นผู้ตัดสิน integration/contract และตรวจ acceptance. งานปานกลางมอบ Luna high; งาน failure/lease/version/retrieval ที่ซับซ้อนใช้ Luna max ตามคำขอผู้ใช้. ไม่มอบไฟล์เดียวกันให้หลาย agent แก้พร้อมกัน; ส่ง contract ก่อนแยกงาน ไม่มี quota/agent พร้อมใช้งานให้ root ทำเองและระบุ self-review ตามจริง

## เมื่อจบ task

- อัปเดต task board และ requirements matrix ในงานเดียวกัน พร้อม link รายงานและข้อที่ยัง pending
- รายงาน source/checkpoint, files changed, commands/exit results, failures corrected, limitations และ manual setup ที่ deferred
- ทดสอบเฉพาะที่สัมพันธ์กับงานแล้วทำ required gates; component pass ไม่ถือว่า whole V1 หรือ live OA ผ่าน
- Independent review ต้องมี verdict จริง; root self-review ห้ามเรียก independent. งาน RED หรือ draft ไม่เปลี่ยนเป็น COMPLETE
- ก่อน commit/push ตรวจ staged files ด้วย `node scripts/security/check-staged.mjs`; ไม่ stage ทั้ง workspace ขณะที่มี worker changes หรือ credentials ที่ไม่เกี่ยวข้อง
- เมื่อ context/limit ขาด ให้ resume task ID เดิมจาก board ไม่เริ่มแผนใหม่จนทับคำสั่งผู้ใช้

## สถานะที่ใช้

`COMPLETE` = acceptance ของ task ผ่านและมีหลักฐาน; `PARTIAL` = บางส่วนมีหลักฐาน; `REOPENED` = พบ gap ต่อสเปค; `PLANNED` = มีขอบเขตแต่ยังไม่เริ่ม; `RED` = failing test ก่อน implementation; `HELD` = ยังมี prerequisite; `MANUAL_PENDING` = ต้องรอ live user/provider/corpus evidence ที่ผู้ใช้อนุญาตให้รวมตอนท้าย

ไม่ใช้จำนวนไฟล์/จำนวน tests คำนวณเปอร์เซ็นต์ความสำเร็จอัตโนมัติ ถ้ารายงานเปอร์เซ็นต์ต้องประกาศ denominator และแยก automated/live acceptance
