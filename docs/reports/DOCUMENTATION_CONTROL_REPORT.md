# DOC-01 — Documentation control checkpoint

4 ตุลาคม 2026, 22:30 Asia/Bangkok. ผู้ใช้ให้ทบทวนต้นฉบับและจัดแผน `.md` ก่อนทำโค้ดต่อ รวม Provider/Model ordering, HTTP/quota/test และ product minimal UX

## ผลงาน

- เก็บต้นฉบับภาพรวม/shortlist/versioning แบบ byte-for-byte ใน `docs/requirements/sources/`; attachmentshortlistซ้ำ deduplicateโดยhash
- เพิ่ม README, project index, AGENTS project rules, PRODUCT/DESIGN baseline, system/provider designs, Provider surface brief, requirements matrix, current task board, decisions, working protocol และ operational/setup checklist
- แผนProviderแยก PRV-01…05: free policy/protocol → reorder/model observations/probes/minimal UI → integrated acceptance. ห้ามกลับM7ก่อนprovidergate
- Mark roadmap/OpenAI-onlyplan/M5report/oldprogressเป็นhistoricalหรือsuperseded scope; เก็บtestproofเดิมแต่ไม่อ้างfullprovider/V1acceptance
- เก็บ all5importinputs/all7structuredtables/amendments/web/loading/staffAI/full13Dashboardmodulesในtasks. RichMenuเป็นsourceproposalที่ต้องdecision ไม่อ้างconfirmedrequirementขึ้นเอง

## Independent planning reviews

| Agent | Model/reasoning | Scope และข้อแก้ที่นำมาใช้ |
|---|---|---|
| docs_spec_review | gpt-6-luna max | original/master coverage: 75uniquechapters,5formats,7datasets,AMENDS,web/loading,staffdrafts,13modules,FlowE; clarifyoptionalRichMenu/requirementvs taskstatus |
| docs_provider_review | gpt-6-luna max | codegap/contract: noOPENAI-onlyacceptance,successHTTP,quotaunit/window/scope/limit>0,atomicreorder; startupmodelprobesFREE_ONLYแม้ALLOW_PAID; previewcapability/3attemptcap |
| docs_ux_review | gpt-6-luna high | minimalbrief: provenance/time/UNKNOWN, globalprovider vs purposemodelorder, keyboard/focus/mobiletouch, perrowtest/recovery, nofixtureaslivemetric |

Root integrated findings. Reviewers assessed plans/specs/code evidence only; no reviewer performed visual/browser QA or accepted pending application behavior. Earlier workerreviewusagefailureยังเป็นhistory ไม่เอามาอ้างfreshverdict

## Verification evidence

- Final one-time Node filesystem/source audit on24central/updatedMarkdown files: **132local links, 0broken**
- Master guide75numberedchapters → matrix75unique CH000–CH074 rows, no missing/duplicate
- Flow A–F มี6rowsครบ; matrixreferencesทั้งหมดresolveไป19defined task IDsในboard
- SHA-256 copiesทั้ง3ตรงattachments; duplicate shortlistattachmentshashตรงกัน
- `git diff --check` exit0; Gitแจ้งLF/CRLFnormalizationตามWindowsconfiguration ไม่มีwhitespaceerror
- Initial audit helper matched onlybareFlowIDsแต่rowsมีdescriptivelabel จึงไม่ได้countflow; regexแก้ให้รับlabelแล้ว finalaudit exit0. Failedhelperrunไม่ใช้เป็นpass

## ขอบเขตของ checkpoint

นี่คือ documentation/planning gate เท่านั้น **ไม่ใช่ app build/test/live acceptance ใหม่**. `tests/ai-pricing.test.ts` ยังคง RED เพราะmoduleยังไม่มี; 426unit/81PG/type/lint/build เป็นcheckpointก่อนRED. M5/M6 provider acceptanceยังreopened และ M7–M9/FlowA–Fยังไม่complete

Detailed M8/M9 executionplansต้องแตกจากboardก่อนcode; ไม่อ้างว่าทุก future file/APIcontractเขียนครบแล้ว. รอบนี้ไม่มี `.env` change, production/provider call, corpus publish, DB mutation หรือ commit/push

DOC-01ปิดหลังminorwording/linkcheck. Next: rootทำ PRV-01 RED→GREEN; freezeinterfacesเพื่อแบ่งadapter/UI/observationงานที่ไม่ชนกันให้ทีม. User-onlystepsยังรวมในfinalsetupchecklistตามauthorizationเดิม
