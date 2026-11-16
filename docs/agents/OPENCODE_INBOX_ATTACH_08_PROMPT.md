# OpenCode — OC-INBOX-ATTACH-08: ปุ่มแนบไฟล์ ยืนยันผู้รับ และถอนสิทธิ์ ใน Inbox

งานนี้ได้รับอนุญาตแล้ว ทำ local commits เท่านั้น ห้าม push, merge, rebase, reset, clean, deploy หรือแก้ Root repository ห้ามประกาศว่า V1 เสร็จ

## ฐานงาน

- Worktree: `D:/project-next/line-ai-yru-opencode-staff`
- สร้าง branch ใหม่ `codex/opencode-inbox-attach` จาก Root commit `803d345` (`git switch -c codex/opencode-inbox-attach 803d345`) ห้ามแก้ branch `codex/opencode-inbox-workflows` เดิม
- ฐานนี้มีงาน OC-07 (DEC-199), Staff upload API 02E (DEC-198), confirm 02F (DEC-201) และ Student viewer/revoke 02G (DEC-202) แล้ว
- อ่านก่อนเริ่ม: `AGENTS.md`, `docs/architecture/CHAT_MEDIA_DESIGN.md` หัวข้อ 02E/02F/02G/02H, DEC-198/201/202 ใน `docs/decisions/DECISION_LOG.md`, `docs/agents/OPENCODE_OPERATOR_COMPLETION_PROMPT.md` (กติกา authority/cache/epoch ที่ยังใช้อยู่ทุกข้อ)
- Artifacts ของ harness ให้ตั้ง `OC_INBOX_ARTIFACTS_DIR` ไว้นอก repo เช่น `D:/codex-cache/yru-ui-qa/oc08/<label>` ห้าม commit `tests/browser/oc-inbox/artifacts/**`

## ขอบเขต

**OpenCode แก้ได้เฉพาะ:**

1. `app/(dashboard)/tickets/[id]/{chat-*,ticket-action-*}` และ `app/(dashboard)/inbox/**` เฉพาะ UI/controller/state
2. `app/tickets.css` เฉพาะส่วน chat/composer ไม่เปลี่ยน global palette
3. `tests/opencode-inbox-attach-*.test.ts(x)`, `tests/browser/oc-inbox/**` (fixture/harness/scenario ใหม่)
4. `docs/ui/OC_INBOX_ATTACH_08_PLAN.md`, `docs/ui/OC_INBOX_ATTACH_08_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_ATTACH_08_REPORT.md`

**ห้ามแตะ:** `lib/**`, `types/**`, `app/api/**`, `app/liff/**`, `supabase/**`, `proxy.ts`, `.env*`, AI/copilot/knowledge panels, LINE/outbox/Storage ทั้งหมด ถ้าต้องการสัญญาที่ไม่มีในเอกสารนี้ ให้เขียนเป็น PROPOSED ใน report แล้วหยุดรอ Root ห้ามสร้าง API เอง

## สัญญา API ที่ใช้ได้ (Root เป็นเจ้าของ ห้ามเปลี่ยน)

ทุก request ใช้ `credentials:'same-origin'`, `cache:'no-store'` ทุก response เป็น no-store JSON ห้ามแสดงข้อความ error ดิบจาก server

### 1. อัปโหลดเป็นร่างส่วนตัว (02E)

`POST /api/chat/tickets/{ticketId}/outbound-attachments` body = ไฟล์ดิบ (ไม่ใช่ multipart) headers:

| Header | ค่า |
|---|---|
| `Content-Type` | `application/pdf`, `image/jpeg` หรือ `image/png` เท่านั้น |
| `X-Yru-Request-Id` | UUID ใหม่ต่อการเลือกไฟล์ 1 ครั้ง ใช้ค่าเดิมเมื่อ retry ไฟล์เดิม |
| `X-Yru-Ticket-Revision` | revision ปัจจุบันของ ticket |
| `X-Yru-File-Name` | `encodeURIComponent(file.name)` |
| `X-Yru-Content-SHA256` | hex ตัวเล็กจาก `crypto.subtle.digest('SHA-256', bytes)` |

ไม่ต้องตั้ง `Content-Length` เอง (browser ตั้งให้) ตรวจฝั่ง client ก่อนส่ง: ชนิดไฟล์ 3 แบบ และขนาด 1 byte ถึง 10 MiB (10,485,760)

ผล: 201 `{attachmentId,status:'READY'}` = ร่างส่วนตัว ยังไม่ส่งถึงนักศึกษา | 409 `DRAFT_FAILED`/`STALE_LEASE`/`CONFLICT` | 400 `INVALID_REQUEST`/`INVALID_ATTACHMENT`/`UNSUPPORTED_TYPE` | 413 `TOO_LARGE` | 404 | 503 `UNAVAILABLE` | 401/403

### 2. ยืนยันผู้รับและส่ง (02F)

`POST /api/chat/tickets/{ticketId}/outbound-attachments/{attachmentId}/confirm` JSON `{requestId, revision, ticketNo}` (ห้ามมี key อื่น)

- `requestId` = UUID ใหม่ต่อการกดยืนยัน 1 ครั้ง ใช้ค่าเดิมเมื่อ retry หลัง network error (replay คืนผลเดิม)
- ผล: 200 `{attachmentId,messageId,status,revision}` | 409 `CONFLICT` (revision เปลี่ยน, ไฟล์ถูกยืนยันแล้ว, ผู้รับ/ผู้รับผิดชอบเปลี่ยน) หรือ `INVALID_ACTION` (เคสไม่อยู่ในโหมดตอบโดยเจ้าหน้าที่) | 404 | 400 | 503
- ข้อความที่ไปถึงนักศึกษาเป็น LIFF link ที่ server สร้างเอง ไม่มีชื่อไฟล์ UI ไม่ต้องสร้างข้อความ

### 3. ถอนสิทธิ์เปิดไฟล์ (02G)

`POST /api/chat/tickets/{ticketId}/outbound-attachments/{attachmentId}/revoke` body `{}`

- ผล: 200 `{attachmentId,revoked:true}` (เรียกซ้ำได้) | 404 | 401/403 | 503
- ไม่ได้ลบข้อความใน LINE แค่ทำให้ลิงก์เปิดไม่ได้ ต้องบอกผู้ใช้ตามนี้

### 4. ข้อมูลใน thread (CHAT-MEDIA-02H, Root ทำขนานกับงานนี้ — ใช้ shape นี้ใน fixture)

`GET /api/chat/tickets/{id}` จะเพิ่ม 2 field (optional ใน type เพื่อให้ทำงานกับ server เก่าได้):

```ts
// InboxThreadResult
outboundFiles?: {enabled:boolean};          // false หรือไม่มี = ซ่อนปุ่มแนบไฟล์ทั้งหมด
// ChatMessage (เฉพาะข้อความ STAFF ที่มาจากการยืนยันไฟล์)
outboundAttachment?: {
 id:string; name:string; mimeType:'application/pdf'|'image/jpeg'|'image/png'; size:number;
 studentAccess:'WAITING_DELIVERY'|'AVAILABLE'|'EXPIRED'|'REVOKED'|'NOT_DELIVERED';
 canRevoke:boolean;
} | null;
```

`name` คือชื่อไฟล์ที่เจ้าหน้าที่อัปโหลด (แสดงเฉพาะฝั่ง Staff) ห้ามอนุมานสถานะจาก `content` ของข้อความ หรือ parse LIFF URL ให้ใช้ field นี้เท่านั้น ระหว่างที่ Root ยังไม่ส่ง field นี้ ให้ fixture เป็นตัวพิสูจน์

## สิ่งที่ต้องทำ

1. **ปุ่มแนบไฟล์ใน composer** แสดงเฉพาะเมื่อ `outboundFiles.enabled === true`, `detail.permissions.reply` เป็นจริง และอยู่ในโหมดตอบนักศึกษา (ไม่ใช่โหมดบันทึกภายใน) ใช้ `<input type="file" accept="application/pdf,image/jpeg,image/png">` ที่มี label ภาษาไทยและใช้คีย์บอร์ดได้
2. **อัปโหลด**: ตรวจชนิด/ขนาดก่อน คำนวณ SHA-256 แล้วส่งตามสัญญาข้อ 1 แสดงสถานะกำลังอัปโหลด ปุ่ม retry ใช้ `X-Yru-Request-Id` เดิม ถ้าเลือกไฟล์ใหม่ให้ใช้ requestId ใหม่ ห้ามอัปโหลดซ้ำอัตโนมัติ
3. **การ์ดร่าง** หลัง 201: แสดงชื่อไฟล์ ชนิด ขนาด และข้อความชัดเจนว่า "ยังไม่ได้ส่งถึงนักศึกษา" มีปุ่ม "ส่งให้นักศึกษา" และ "นำออก" (นำออกจาก UI เท่านั้น ไม่มี API ลบร่าง ให้บอกว่าไฟล์ร่างยังเก็บแบบส่วนตัวในระบบ)
4. **ยืนยันผู้รับ** ต้องเป็นการกดของคนโดยตรง: dialog แสดงเลข ticket (`ticketNo`) และชื่อไฟล์ ปุ่มยืนยันส่งตามสัญญาข้อ 2 ด้วย revision ปัจจุบัน ห้ามยิง confirm อัตโนมัติหลัง upload ห้าม retry ด้วย revision ใหม่เองเมื่อได้ 409 `CONFLICT` ให้โหลด thread ใหม่แล้วให้เจ้าหน้าที่กดยืนยันอีกครั้ง (นี่คือ human re-review ตาม DEC-201)
5. **หลังยืนยันสำเร็จ**: อัปเดต revision เหมือนการตอบปกติ ลบการ์ดร่าง แล้วรอข้อความจริงจาก Realtime/refetch ห้ามสร้างข้อความปลอมที่แสดงว่าส่งแล้ว
6. **ข้อความที่มี `outboundAttachment`**: แสดงชื่อไฟล์/ชนิด/ขนาด และสถานะภาษาไทยตาม `studentAccess` (เช่น รอส่งถึง LINE, นักศึกษาเปิดได้, หมดเวลาเปิด (30 วัน), ถอนสิทธิ์แล้ว, ส่งไม่สำเร็จ) ปุ่ม "ถอนสิทธิ์เปิดไฟล์" แสดงเฉพาะ `canRevoke` มี dialog ยืนยันที่บอกว่าข้อความใน LINE ยังอยู่ แต่ลิงก์จะเปิดไม่ได้ หลัง 200 ให้ refetch แทนการเดาสถานะ
7. **Authority/cache**: ร่าง, requestId, สถานะอัปโหลด/ยืนยัน/ถอนสิทธิ์ ต้องเก็บแยกต่อ actor+ticket ตามรูปแบบ per-room store ของ OC-06/07 และถูกล้างตามกติกาเดิม: 401 reset ทั้ง actor ทันที, 403/404 ล้างเฉพาะห้อง, ผลจาก authority epoch เก่าถูกทิ้ง ผลของห้อง A ห้ามไปโผล่ในห้อง B ไฟล์ bytes ห้ามเก็บไว้หลังอัปโหลดเสร็จหรือเปลี่ยนห้อง
8. **ข้อจำกัดที่ยอมรับ**: ร่าง READY ที่ยังไม่ยืนยันจะหายจาก UI หลัง reload เพราะยังไม่มี API รายการร่าง ให้เขียนไว้ใน report และเตือนผู้ใช้ด้วยข้อความสั้นบนการ์ดร่าง

## การทดสอบ (เขียน RED ก่อน)

- Unit: ตัวสร้าง headers/การตรวจไฟล์/SHA-256, mapping ของ error code → ข้อความไทย (ห้ามมีข้อความดิบ), mapping `studentAccess`
- Mounted scenarios ใหม่ต่อจาก S27 ใน harness (fixture routes จำลอง 3 endpoint และ thread ที่มี/ไม่มี field 02H) อย่างน้อย:
  - S28 ปุ่มซ่อนเมื่อ `outboundFiles` ไม่มี/false, ไม่มีสิทธิ์ reply หรืออยู่โหมดบันทึกภายใน
  - S29 อัปโหลดสำเร็จ: headers ครบและถูกต้อง SHA ตรงกับ bytes จริง แล้วได้การ์ดร่าง ไม่มี confirm อัตโนมัติ
  - S30 ชนิดผิด/ใหญ่เกิน ถูกปฏิเสธก่อนมี request
  - S31 network error แล้ว retry ใช้ requestId เดิมทั้ง upload และ confirm
  - S32 confirm ได้ 409 CONFLICT → refetch แล้วต้องกดยืนยันใหม่เอง ไม่มี request ที่สอง
  - S33 confirm สำเร็จ: revision ใหม่ใช้กับการตอบครั้งต่อไป การ์ดร่างหาย ไม่มีข้อความปลอม
  - S34 ถอนสิทธิ์: dialog, request ถูก endpoint, refetch, ปุ่มหายเมื่อ `canRevoke:false`
  - S35 ห้อง A อัปโหลด/confirm ค้าง แล้วเปลี่ยนไปห้อง B: ผลของ A ไม่ปรากฏใน B และ 401 ระหว่างค้างล้างทั้ง actor
- รัน mounted matrix เต็มชุด S01–S27 เดิมต้องผ่านทั้งหมดด้วย

## หลักฐานที่ต้องส่ง

- exact SHAs ทุก commit, clean status, ตรวจ allowlist ทุก commit (`git diff --name-only 803d345..HEAD`)
- typecheck, lint, full unit (`--maxWorkers=1 --testTimeout=20000`), `git diff --check`, `scripts/security/check-staged.mjs`
- matrix เต็มพร้อม label: จำนวน RED ก่อนแก้ และ GREEN หลังแก้ แยกกัน; SHA256 ของ fixture เดิมไม่เปลี่ยน
- `pnpm build` ใน worktree อาจ BLOCKED จาก junction ให้รายงาน exit จริง Root จะ build หลังรวม
- ห้ามอ้างว่าทดสอบกับ LINE/LIFF/Storage/OAuth จริง, Flow A–F หรือ V1 complete
