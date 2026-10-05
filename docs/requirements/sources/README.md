# ต้นฉบับจากผู้ใช้

เก็บสำเนาไฟล์ที่ผู้ใช้แนบซ้ำเมื่อ 4 ตุลาคม 2026 แบบ byte-for-byte เพื่อให้ agent รุ่นถัดไปอ่านข้อกำหนดได้จาก repository ไม่ต้องอาศัย attachment path หรือความจำจากแชต ไม่แก้ข้อความต้นฉบับเพื่อให้ตรงกับ implementation

| แหล่ง | Attachment ล่าสุด | SHA-256 |
|---|---|---|
| [ภาพรวมระบบ](original-overview.th.md) | fd886d53-77c4-46d6-a64a-02b7e8c98782 | `E510356386DDCBE99B486126551E00B8467C2F50699A8F0FA6211A712DAD7B44` |
| [รายการเอกสารเริ่มต้น](original-knowledge-shortlist.th.md) | 4cefe7e1-9d39-419c-bc14-82255adee86a | `6FFD3937750199109F7607B18BF1B2B81B4019F0F0A97F56D04B6003AF26F23A` |
| [Import และ versioning](original-document-versioning.th.md) | 909e7456-ec95-4b38-8401-61c5b2373a51 | `65ED293729A3BA0A5B7A5C52248464B1C6D8DB3AD1D11C38D089C89D8113A750` |

Attachment 5ff2544c-93d9-4591-a798-9fac1cb9196e มี hash ตรงกับรายการเอกสารเริ่มต้น จึงไม่สร้างสำเนาที่ซ้ำกันอีกไฟล์ URL/ปีการศึกษาในต้นฉบับเป็นข้อมูล ณ เวลาร่าง ไม่ถือว่าได้รับการตรวจ current/approved อัตโนมัติ

แหล่งที่ต้องใช้ร่วมกัน: [Master guide](../../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [คำยืนยันล่าสุดและ decisions](../../decisions/DECISION_LOG.md), [requirements matrix](../V1_REQUIREMENTS_MATRIX.md)

## จุดอ้างอิงที่ห้ามหลง

Latest 5 October human architecture update: [local E5 specification](2026-10-05-local-e5-embedding.md), attachment `dd6e03c6-fcf7-40db-b544-eb382014a0e4`, SHA-256 `F2936E3049D13A1AA4B1208237BE810982A6BB7715032E76E72FCDB48C4AEFF4`. Preserved byte-for-byte. CPU E5/384 infrastructure replaces normal embedding model selection; free generation/import review requirements remain.

- ภาพรวม §§32–36: Zen/OpenRouter/Provider X, เพิ่ม provider ผ่าน Dashboard, priority ของ provider และ model, deterministic fallback, health และ usage/errors
- ภาพรวม §22 และคำยืนยันล่าสุด: ประหยัด free quota; startup ใช้ AI ฟรีทั้งหมด Paid Emergency เป็นตัวอย่างในอดีต ไม่ใช่ค่า default ที่อนุมัติแล้ว
- ภาพรวม §§17–18: หลาย conversation/ticket และ quick reply เมื่อแยกบริบทไม่ชัด
- Versioning §§1–20: current/superseded/history, schema registry, authority, amendments, preview และ explicit approval
- คำขอล่าสุดเพิ่มความชัดเจนของ UX: เลื่อนขึ้นลง, HTTP ต่อ model, โควต้าเมื่อมีหลักฐาน และปุ่มทดสอบ ต้องไม่อ้างว่าคำว่า drag-and-drop หรือ quota API ทุกเจ้าเขียนไว้ตรงตัวในต้นฉบับ
