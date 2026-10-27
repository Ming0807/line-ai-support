# YRU AI Helpdesk — จุดเริ่มอ่าน

อัปเดต 27 ตุลาคม 2026 โดย root หลังเผยแพร่ชุดเริ่มต้นในขอบเขตที่ตรวจทานได้. **V1 ยังไม่เสร็จและยังรอการตรวจรับจากผู้ใช้บน LINE จริง** ผู้ใช้สั่งหยุดทดสอบคำตอบ Gemini เพิ่มและจะทดสอบเองภายหลัง; ไม่เริ่ม profile ใหม่หรือเปลี่ยน provider/key/timeout จากการตรวจครั้งนี้

## อ่านตามลำดับนี้

1. [AGENTS](../AGENTS.md) และ [บอร์ดงานปัจจุบัน](tasks/V1_TASK_BOARD.md)
2. [Master guide](../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [ต้นฉบับ](requirements/sources/README.md), [requirements matrix](requirements/V1_REQUIREMENTS_MATRIX.md)
3. [System design](architecture/YRU_V1_DESIGN.md), subsystem design และ execution plan
4. [Decision log](decisions/DECISION_LOG.md), ล่าสุด DEC-176; รายงานเก่าเป็นหลักฐานตามวันที่และขอบเขตของตน
5. Next.js changes ต้องอ่านคู่มือที่ติดตั้งตาม AGENTS

## สถานะปัจจุบัน

- ROOT-CORPUS-PUBLIC-04: เผยแพร่ชุดเริ่มต้น13รายการในขอบเขตที่ตรวจทานได้แล้ว ฐานDEVELOPMENTมี15 approved PUBLICรวม2เอกสารเพิ่มเติม ตรวจreceipt/replay/การค้นคืนE5จริง6รายการรอบนี้ผ่าน; ปฏิทิน2ฉบับและประกาศกิจกรรมเป็นส่วนตรวจทานที่มีข้อจำกัด ไม่ใช่รับรองทุกช่อง/ทุกรุ่น ดู[ข้อเท็จจริง](operations/CORPUS_DECISION_PACKETS.md). ทั้ง7structuredtablesยัง0rows. Migration45ผ่านguarded apply,74ตารางRLS,ข้อมูลเอกสารเดิมไม่เปลี่ยนระหว่างmigration;3330unit/245files,type/lint/buildและ17affectedownedPGผ่าน. LiveGemini/LINE/actualHermesยังไม่ทดสอบรอบนี้.
- [แผนสนทนา ROOT-NATURAL-01](superpowers/plans/2026-10-27-natural-university-assistant.md): ตรวจflowจริง,วัดคุณภาพแยกความครบ/หลักฐาน,ปรับแบบมีขอบเขต และเปรียบเทียบHermesก่อนตัดสินใจใช้ฝั่งนักศึกษา. นี่คือแผน ไม่ใช่ฟีเจอร์ที่ทำเสร็จแล้ว.
- ROOT-NATURAL-02 / DEC176: เมื่อการแก้คำแนะนำทั่วไปแบบMIXEDล้ม ยังค้นข้อมูลทางการจากคำถามเดิมและแจ้งว่าส่วนทั่วไปยังไม่ครบ; targeted103และownedPG19ผ่านด้วยmock model/LINE. ไม่อ้างว่าคุณภาพA10หรือการทดสอบจริงผ่าน.

- งานGLMเดิมถึง4449381ได้รับrootauditแล้ว; งานHermes/QAและownedacceptanceรอบใหม่เก็บในlocalcommit`9948ba9`(26ตุลาคม). ตัวเลขoriginal/repeatและข้อจำกัดเดิมยังแยกไว้ ไม่เปลี่ยนprovider/key/timeoutหรือเรียกmodeltestsเพิ่ม
- Gemini main6 บน source3 มีหลักฐานเดิมครบ30กรณี:29/30 trajectories,19/20 usefulและmandatorygates. ไม่ได้ยิงทดสอบโมเดลเพิ่มรอบตรวจนี้
- Repeat2 ครบ21executionsและsafetygates แต่ทั้ง3A10ให้เพียงข้อมูลทางการพร้อมแจ้งว่าส่วนคำแนะนำทั่วไปยังตอบไม่ครบ. คำกล่าว21/21ผ่านความครบถ้วนถูกแก้ด้วยaudit DEC-167 โดยเก็บต้นฉบับไว้; ผู้ใช้รับการทดสอบสนทนาต่อเองภายหลัง
- Hermes: ต่อStaff Copilotเข้าหน้าเคสDashboardแล้วตาม[แผน](superpowers/plans/2026-10-25-hermes-staff-dashboard.md). ใช้native cacheเฉพาะเมื่อเจ้าหน้าที่กด ผูกผู้รับผิดชอบ/หัวหน้า+ticket+revision และตรวจหลักฐานซ้ำหลังร่างเสร็จ. แสดงร่างครบ/แก้ไข/นำเข้าช่องตอบกลับเอง; ไม่ส่งอัตโนมัติ. Controlled child/loopback/PG/browserผ่าน; actualHermes+modeldraftยังรอผู้ใช้ ไม่มีStudent responderใหม่
- QA pre-screenerเป็นคิวให้คนตรวจ ผูกartifactSHAกับreview; gap reportเป็นSUPER_ADMIN aggregateที่ไม่คืนข้อความผู้ใช้. ไม่ใช่ผู้ตัดสินว่าความรู้หรือโมเดลผ่าน
- Runtimeเปิดด้วยlocal:aiแล้ว25ตุลาคม21:24Bangkok: E5/เว็บ/4workers/tunnelREADY, local+publicHMAC8checksPASS. URLรอบนี้อยู่[checklist](operations/FINAL_SETUP_CHECKLIST.md); ตรวจregistry/workerแบบอ่านอย่างเดียวพบgenerationattempts0หลังstartupถึง21:27. ไม่รันHermes/modeltestและไม่เปลี่ยนprovider/key/timeout
- Providerเพิ่มเติม/local generationเลื่อนตามผู้ใช้(DEC-165); ใช้Gemini FREE_ONLYตัวเดิม การต่ออายุattestationถึง24พ.ย.เป็นผลที่GLMบันทึกไว้ ไม่ใช่การตรวจbillingจากvendor
- ROOT-CORPUS-PUBLIC-02เผยแพร่YRU182ห้องสมุดและYRU027แบบฟอร์มว่างผ่านnormalreview/receipt/currentE5retrievalแล้ว26ตุลาคม: ฐานจริงมี7approvedPUBLICและทั้ง7structuredtablesยัง0rows. เหลือ7starteritemsต้องsource/extraction/mappingต่อ ไม่ยกcontrolledtestsหรือRAGpublicationเป็นstructuredcorpusacceptance
- ROOT-CORPUS-PUBLIC-03 / DEC174: ผู้ใช้ยกเลิกส่งต่อGLMและให้rootทำเอง. เพิ่มการตรวจแผนภาพที่ผูกกับคำเตือน/หน้า/เหตุผลโดยคงparser findings; normalYRU034และปฏิทินเกินหน่วยกิต2569เผยแพร่/receipt/replay/currentlocatedE5แล้ว รวมPUBLIC9. ปฏิทินเฉพาะเรื่องไม่ข้ามปีและทั้งสองฉบับไม่ใช้ตอบย้อนหลัง. แก้สำเนาถอดปฏิทินหลักและแยกข้อขัดแย้งต้นฉบับ5จุด; ไม่เผยแพร่ทั้งฉบับแบบไม่มีเงื่อนไข
- งานค้าง: actualFlowA–F/actualHermesdraftreview/activationและdeploymentรอผู้ใช้; structuredmappingและขอบเขตแหล่งข้อมูลที่ยังงดใช้ยังเป็นimplementation/datawork. ทั้ง7structuredtablesยัง0rows. Date/template/diagramcontractsแก้แล้วสำหรับpublicRAGschema4; authorityscopesและSTRUCTURED/BOTHยังไม่ถูกลดscope [ข้อเท็จจริง](operations/CORPUS_DECISION_PACKETS.md). ไม่reset/clean/stashหรือstageทั้งworkingtree

ผลตรวจROOT-GLM-HERMES-01ก่อนต่อUI:3235tests/236files,type/full lint/build408inputs,ownedPG9/43migrations/credentialscan1592files. ผลรอบต่อUIล่าสุดอยู่[บอร์ดงาน](tasks/V1_TASK_BOARD.md)และ[execution plan](superpowers/plans/2026-10-25-hermes-staff-dashboard.md); มีrootintegrationและLunascopedreviewจริง แต่ไม่มีliveHermes/Gemini/OAqualificationเพิ่มเติม

26ตุลาคมROOT-CLOSEOUT-01:657registeredPG/41groups/43migrations/exactcleanup,advisors0ERROR/0WARN/111INFO,3272unit/type/lint/full849inputbuild/899codefreezeผ่านครบ. แก้testoracles/fixturecleanupตามDEC169–171และcommit52ไฟล์ใน`9948ba9`;generatednext-env.d.tsไม่รวมและยังunstaged. งานข้อมูลจริง/ตรวจรับจริง/deployยังค้างตามบอร์ด ไม่ยิงโมเดลเพิ่ม

## เอกสารตามงาน

| งาน | เอกสารหลัก |
| --- | --- |
| Product / UI | [PRODUCT](../PRODUCT.md), [DESIGN](../DESIGN.md) |
| LINE/context/Staff | [Context routing](architecture/AI_CONTEXT_ROUTING_DESIGN.md), [Staff binding](architecture/STAFF_LINE_BINDING_DESIGN.md) |
| AI / support / acceptance | [Support workflow](architecture/AI_SUPPORT_WORKFLOW_DESIGN.md), [support state](architecture/AI_SUPPORT_STATE_DESIGN.md), [continuation plan](superpowers/plans/2026-10-14-v1-completion-handoff.md), [current quality experiment](superpowers/plans/2026-10-20-evidence-first-mixed.md) |
| Provider/model/order/FREE_ONLY | [Provider design](architecture/AI_PROVIDER_DESIGN.md) |
| RAG / Import / Structured | [Import design](architecture/KNOWLEDGE_IMPORT_DESIGN.md), [structured schema](architecture/STRUCTURED_SCHEMA_DESIGN.md), [embedding service](architecture/EMBEDDING_SERVICE_DESIGN.md) |
| Local one-command run | [Local test instructions](operations/LOCAL_TEST.md), [preview plan/evidence](superpowers/plans/2026-10-20-local-ai-preview.md) |
| Deferred human configuration/test | [Final setup checklist](operations/FINAL_SETUP_CHECKLIST.md) |
| แผนต่อยอดหลัง V1 | [Post-V1 roadmap](tasks/POST_V1_ROADMAP.md) — 4 เฟส + critical path + คำเตือน attestation หมดอายุ 28 ต.ค. |
| Corpus files | [Catalog](../documents/yru/CATALOG.md), [completeness](../documents/yru/COMPLETENESS.md), [starter review](../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md) |
| Delegation and evidence | [Working protocol](agents/WORKING_PROTOCOL.md) |

## ลำดับอำนาจและประวัติ

คำสั่งผู้ใช้ล่าสุด → ข้อกำหนดเดิมที่ยังใช้และ decision ที่ระบุ conflict/resolution → design/plan → โค้ดและผลทดสอบที่มี source scope รายงานเก่าไม่แทน current requirement หรือ current pass

[สำเนา index ก่อนจัดระเบียบ](PROJECT_INDEX_HISTORY_2026-10-20.md) เก็บ bytes เดิมทั้งหมด รวมทั้ง checkpoint และลิงก์เก่าไว้เป็นประวัติ บอร์ดงานปัจจุบันเป็นสถานะหลักเพียงจุดเดียว ไม่เพิ่มรายงานยาวซ้ำไว้หน้าทุกเอกสารต่อไป
