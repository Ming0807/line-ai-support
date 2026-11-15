# OpenCode — OC-OPERATOR-07: fix read-ack with real sequences and close OC-06 review gaps

งานนี้ได้รับอนุญาตแล้ว ทำ local commits เท่านั้น ห้าม push, merge, rebase, reset, clean, deploy หรือแก้ Root repository รอบนี้เล็ก ให้ทำทุกข้อในตารางให้จบในรอบเดียว

## ฐานงาน

- Worktree: `D:/project-next/line-ai-yru-opencode-staff`
- Branch: `codex/opencode-inbox-workflows`
- Exact starting HEAD: `851625a` (OC-OPERATOR-06 final) ห้ามเขียนทับประวัติ04/05/06
- Allowlist และข้อห้ามเหมือน [OC-OPERATOR-06](OPENCODE_OPERATOR_COMPLETION_PROMPT.md) ทุกข้อ
- **ห้าม commit `tests/browser/oc-inbox/artifacts/**` เพิ่ม** ให้ตั้ง `OC_INBOX_ARTIFACTS_DIR` ไปไว้นอก repo เช่น `D:/codex-cache/yru-ui-qa/oc07/<label>` แล้วรายงานเฉพาะ summary/counts/SHA256 ใน report Root จะรวมเฉพาะ source/tests/docs และใส่ artifacts ไว้ใน `.gitignore` ตอนรวม

## ผล Root ตรวจ OC-06 (15 พฤศจิกายน 2026)

Root นำ diff ของ `d51e732..851625a` เข้า tree ปัจจุบันโดยไม่รวม artifacts แล้ว matrix ที่ mount จริงผ่าน S01–S24 ครบ 24/24 รวม S16–S18 ซึ่งเป็น 3 counterexample ของ OC-05 การแก้ authority epoch, per-room busy/notice และ requestId-guarded clear ถูกทิศทาง แต่ยังรวมไม่ได้เพราะเหตุผลต่อไปนี้

### P2 (ต้องแก้ก่อนรวม) — RX4 ทำให้ห้องที่ยังไม่เคยอ่านไม่ถูกบันทึกว่าอ่านแล้วเลย

ใน Root ค่า `private.inbox_message_order.message_seq` คือ `generated always as identity unique` และใช้เลขชุดเดียวกันทุก ticket (ดู `supabase/migrations/20261028151952_dashboard_inbox_core.sql` และ `lib/chat/service.ts` `readThread`/`markRead`) เลขข้อความของ ticket เดียวจึงไม่ต่อกันและไม่เริ่มที่ 1 เช่น 5, 9, 12

Root probe ที่ใช้ฟังก์ชันจริงจาก 851625a: ข้อความ 5/9/12, `hasMore:false`, cursor 0 → `spans:[{lo:5,hi:12}]`, `firstCatchUpBefore:null`, `contiguousReadTarget(0,spans)=0` ผลคือ effect ใน `chat-thread-ops.ts` ทำ `if (target <= known) return;` และไม่ส่ง `POST /read` ห้องนี้จึงค้างสถานะยังไม่อ่านตลอด ก่อน OC-06 ส่วนนี้ทำงานได้ fixture ใช้ `sequence: seqFrom + index` ที่ต่อกันจาก 1 จึงไม่เห็นปัญหานี้

เกณฑ์แก้:

1. เขียน RED ก่อน: unit test ของ `contiguousReadTarget`/merge และ mounted scenario ใหม่ที่ใช้เลขไม่ต่อกันและไม่เริ่มที่ 1 (เช่น 5/9/12 และหน้าต่าง 51 รายการที่ `hasMore:true`) โดยวัด POST `/read` และ `throughSequence` จริงหลัง React commit
2. กฎ "ห้าม ACK ข้ามประวัติที่ยังไม่โหลด" (prompt 05 ข้อ 11) ยังต้องคงอยู่ แต่ช่องว่างที่ server พิสูจน์แล้วว่าไม่มีข้อความของ ticket นี้ต้องถือว่าครอบคลุมแล้ว อย่างน้อยต้องรองรับ (ก) `hasMore:false` แปลว่าไม่มีข้อความก่อนข้อความแรก (ข) ช่วงระหว่าง span ที่มาจาก response หน้าต่างเดียวกันถือว่าต่อกันตามที่ server คืนมา (ค) `empties` ที่พิสูจน์แล้ว ส่วนกรณี `hasMore:true` ที่ข้อความเก่ากว่ายังไม่โหลดจริงต้องยังไม่ ACK หรือต้องเติม gap ก่อน
3. `throughSequence` ต้องเป็น `sequence` ที่มีอยู่จริงใน ticket นั้น เพราะ server ตอบ `INVALID_REQUEST` ถ้าไม่มี
4. ปรับ fixture ทั้งชุดให้มีกรณีเลขไม่ต่อกันอย่างน้อยหนึ่งห้อง และห้ามเปลี่ยน S14 เดิมให้อ่อนลง

### P3 (แก้ในรอบเดียวกัน)

1. **401 ต้อง reset ทั้ง actor ทันที**: 401 จาก thread/read/lifecycle ตอนนี้ลบเฉพาะห้องนั้น แล้วไปพึ่ง `requestList` ให้ list ตอบ 401 อีกครั้งจึงจะ reset ทั้ง actor ระหว่างที่ list request ยังค้าง การกดแถว B ยังเผย cache ของ B ได้ ให้ 401 (session หาย) เรียก whole-actor reset ทันที ส่วน 403/404 คง scope เฉพาะห้องไว้ เขียน mounted RED: เปิด A และ B จนมี cache → A ได้ 401 → list ค้าง → กด B → ต้องไม่เห็นข้อความหรือร่างของ B ก่อน GET ใหม่
2. **read-ack 403 ที่มาจาก epoch เก่าต้องไม่ปิดห้องที่ได้รับอนุญาตใหม่แล้ว**: ทางล้มเหลวของ read POST ยังไม่ตรวจ `authorityEpochRef` ลำดับที่ทำให้เกิด: POST A/read ค้าง → list denial → list 200 → GET A ใหม่ 200 แสดงผล → A/read เก่าตอบ 403 → A ถูกลบและปิด ให้ผูกผลนี้กับ epoch ของตอนส่ง request ถ้า epoch เปลี่ยนแล้วให้ทิ้งผล หรือขอ revalidate ห้องนั้นแทนการปิดทันที
3. **S16 ต้องตรงกับ repro เดิมของ Root**: repro เดิมมี B ถูกเลือกอยู่ตอน list ตอบ 403 (เปิด A พิมพ์ร่าง → เปิด B → list 403 → list 200 แต่ GET A ค้าง → เลือก A) ให้เพิ่มกรณีนี้โดยไม่ลบ S16 เดิม
4. **S18 ต้องรอ React commit ก่อนตรวจว่าไม่มีผลรั่ว**: `afterSuccess` ตอนนี้อ่าน notice ทันทีหลัง `deferredKeys` ว่าง ซึ่งเป็นรูปแบบที่ prompt 06 ห้ามไว้ ให้ใช้ barrier ที่สังเกตได้ เช่น ผลของ A ถูกบันทึกใน per-room store แล้ว หรือ requestAnimationFrame สองรอบหลัง `response.json` resolve แล้วจึงวัด DOM ของ B ใช้แบบเดียวกันใน S17 และตรวจ URL/notice ของ B ด้วย
5. **README/report**: แก้ข้อความใน report ของ 06 ที่ว่า onboarding API ของ Root ยัง PROPOSED เพราะ Root มี route เหล่านี้แล้วตั้งแต่ `0968451` ให้ทำเป็น erratum ที่ลงวันที่ ห้ามลบข้อความเดิม

## หลักฐานที่ต้องส่ง

- exact SHAs, clean status, typecheck/lint/full unit (`--maxWorkers=1 --testTimeout=20000`), `git diff --check`, `scripts/security/check-staged.mjs`, frozen fixture SHA256 ไม่เปลี่ยน
- mounted matrix เต็มชุดพร้อม label ใหม่ ซึ่งต้องผ่านเดิม 24 scenario รวมกับ scenario ใหม่ บอกจำนวน RED ก่อนแก้และ GREEN หลังแก้แยกกัน
- `pnpm build` ใน worktree ยัง BLOCKED จาก junction ได้ ให้บอก exit จริง Root จะ build เองหลังรวม
- ห้ามอ้าง real LINE/OAuth/Realtime/Flow A–F หรือ V1 complete
