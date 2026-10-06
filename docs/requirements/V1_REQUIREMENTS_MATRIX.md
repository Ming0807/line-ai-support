# V1 Requirements coverage matrix

อัปเดต 4 ตุลาคม 2026 หลัง reread ต้นฉบับและคำยืนยันล่าสุด. [แหล่งต้นฉบับ](sources/README.md), [Master](../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [design](../architecture/YRU_V1_DESIGN.md), [board](../tasks/V1_TASK_BOARD.md)

`CH000`–`CH074` map ทุก chapter ของ master; coverage ของ heading **ไม่เท่ากับทุก field/subcase ผ่านแล้ว**. Evidence columnเป็นที่ตรวจ componentและสิ่งที่ยังขาด; `PARTIAL/REOPENED/PLANNED` ห้ามนับเป็น complete. หน้าที่มีคำว่า test/mock ไม่ถือว่า live provider/OA ผ่าน

## Master guide: 75 chapters

| Requirement | § / ข้อกำหนด | Task / milestone | Coverage / evidence และ gap |
|---|---|---|---|
| CH000 | 0 V1 goals 23ข้อ | M1–M9, FINAL-01 | PARTIAL: ต้องผ่าน runtimefree/import5formats/structured/multi-context/Flow A–Fครบ |
| CH001 | 1 Stack | M1, IMP-01, FINAL-01 | PARTIAL: Next/TS/Auth/PG/pgvector/Zod/testsมี; Storage/import/productiondeploymentยังpending |
| CH002 | 2 Backendtools/Anonymous/Migration≠Import/Versioning | all, IMP-03, STR-01 | PARTIAL: auth/anonymous/toolsimplemented; import/publicationยังpending; ห้ามStudentDB/arbitrarySQL/autopublish |
| CH003 | 3 ProjectStructure | all | PARTIAL: app/lib/testsมี แต่ knowledge/incidents/usage/log/settings surfacesไม่ครบ; behavior mappingมาก่อนชื่อไฟล์ตัวอย่าง |
| CH004 | 4 Migration foundation | M1, M7–M9 | PARTIAL: local+DEV19migrations/31RLS, isolated19replay/foundationRLS/advisors GREEN; import/structured/incidents remaining ไม่สร้างmigrationต่อเอกสาร |
| CH005 | 5 LINEsession | M1/M3 | COMPONENT_EVIDENCE: foundation/privacy/identity/ingress tests; rawtechnicalidentityไม่ browser |
| CH006 | 6 Conversation/messages | M1/M3/M4, RAG-01 | PARTIAL: durableownership/historyมี; fullsemanticAInewtopicต้องreverifyfreeflow |
| CH007 | 7 Tickets | M4, FINAL-01 | COMPONENT_EVIDENCE: ticket schema/lifecycle/actualPG+HTTP; realOAfullflowpending |
| CH008 | 8 Tickethistory | M4 | COMPONENT_EVIDENCE: history/audit/idempotentaction fixturesในM4report |
| CH009 | 9 Documentversioning | M6, IMP-03 | PARTIAL: documents/families/relationships/currentconstraintsมี; approvedversionupdateUI/atomicpublishpending |
| CH010 | 10 Knowledgechunks | M6, IMP-01/03 | PARTIAL: cohort/page/section/chunk/retrieval tests; realimportembeddingspending |
| CH011 | 11 Importjobs/staging | IMP-01…03 | PARTIAL: privateimmutableencryptedjob/metadata/original/uploadreceipt/auth/duplicate/failure/readStorage+PG GREEN; persistedextraction/review/publication states pending |
| CH012 | 12 Sevenstructuredtables | STR-01/02 | PLANNED: calendar,fees,transfer,services,systems,forms,announcementsทั้งหมด |
| CH013 | 13 Incidents/ticketlinks | ADV-02 | PLANNED: schema/permissions/aggregation/UX |
| CH014 | 14 Provider/modeltables | PRV-01…04 | AUTOMATED_ACCEPTANCE/MANUAL_PENDING: free/order/pricing/HTTP/quota/probes/cooldown/compatible PG+UI GREEN ดู[acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md); live account/quality pending |
| CH015 | 15 Usage/errors | M5, PRV-04, ADV-03 | PARTIAL: attempts/errors/actualHTTP/probe separation/cooldown GREEN; complete usage/log/analytics UI remaining |
| CH016 | 16 Activities/audit | M1/M4/M5, IMP-03, ADV-03 | PARTIAL: ticket/provider/import/extraction/review safe auditsมี; review12PG atomic rollback PASS; publication/settings/fullUIยังpending |
| CH017 | 17 RLS | all | COMPONENT_EVIDENCE: foundation+actual3rolescrossdeptprivacy; everynewtableต้องretest |
| CH018 | 18 Searchfunctions/metadatafirst | M6, STR-02 | PARTIAL: exactfilteredretrievalactualPGมี; fixedstructuredqueryremaining |
| CH019 | 19 Indexes | M1/M4/M6, M7–M9 | PARTIAL: currentindexesมี; newtableindexes/performancechecksตามscope; ANNยังไม่configured |
| CH020 | 20 ENVvalidation | M1, PRV-05, FINAL-01 | PARTIAL: Zod/modern+legacySupabase/envexampleมี; freeconfiguration/finalrunbookต้องalign |
| CH021 | 21 Studentwebhook | M3, RAG-01, ADV-04 | PARTIAL: rawHMAC/validempty/commitACKมี; fullAI/loading/deadlineacceptancepending |
| CH022 | 22 SpamGuard | M3/M4, PRV-05 | COMPONENT_EVIDENCE: arrivalrate/duplicatesbeforeAI; reproveproviderHTTP=0forspamafterintegration |
| CH023 | 23 ConversationRouter | M4/M6, RAG-01 | PARTIAL: pure/PG/HTTPmulti-context+opaquechoices; semanticfreeproviderfullFlowEpending |
| CH024 | 24 QuickReply | M4/M6, FINAL-01 | COMPONENT_EVIDENCE: ownedopaqueexpire/dedupcontext/confirm choices; realOAflowpending |
| CH025 | 25 StateMachine | M4 | COMPONENT_EVIDENCE: invalidtransitions/revision/history; noarbitrarystatus |
| CH026 | 26 HumanTakeover | M4/M6, PRV-05 | COMPONENT_EVIDENCE: HUMANrace/outboxsuppressionfixture; freeflowregressionrequired |
| CH027 | 27 TicketCreation | M4/M6, FINAL-01 | PARTIAL: consumedownedconfirmation/receipts/scopedroute; actualescalationfree+notificationlivepending |
| CH028 | 28 DepartmentRouting | M4/M6, RAG-01 | COMPONENT_EVIDENCE: activedepartment/REGISTRARalias/backendmapping; fullAIcontextacceptancepending |
| CH029 | 29 Gateway/fallback | PRV-01/02/05 | AUTOMATED_ACCEPTANCE/MANUAL_PENDING: fresh free/deadline3attempts/fallback/cooldown/paidHTTP0 and configured signed free RAG fixture GREEN; live free model quality pending |
| CH030 | 30 ProviderRegistry | PRV-02/03 | AUTOMATED_ACCEPTANCE: official Zen CHAT/Responses + OpenRouter CHAT/embedding + compatible chat/embedding registered; authenticated PG and actual UI persistence/key/DNS/TLS gates GREEN |
| CH031 | 31 AIOutputSchema | M5/M6, RAG-01 | PARTIAL: strictschemasมี; eachbusinessintent/tool/routingfieldmappingต้องaudit ไม่เอาvalidJSONแทนbusinesspass |
| CH032 | 32 RAG | M6, PRV-05, IMP-04 | PARTIAL: controlledcurrent/historycitationsผ่าน; freeactualapprovedPDF/liveevidencepending |
| CH033 | 33 MetadataFilter | M6, IMP-03 | COMPONENT_EVIDENCE: official/public/reviewed/current/effective/applicabilitybeforevectors; publicationregressionrequired |
| CH034 | 34 Historicalquestions | M6, IMP-03, PRV-05 | PARTIAL: explicityear/date/usergroundedtestsมี; realversions/freeflowpending |
| CH035 | 35 Chunking | M6, IMP-01/02 | COMPONENT_EVIDENCE: section/page/Thai/tablechunktests; parserintegrationallformatsremaining |
| CH036 | 36 Importservice | IMP-01…04 | PARTIAL: private original→supervised parser→encrypted located revision/preview/reason-bound edit/CAS and private UI PASS; review/version/publication/corpus/location→citations remain; [report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md) |
| CH037 | 37 Analyzer | IMP-01/02 | COMPONENT_PASS: deterministic proposals/sensitivity rerun after located parser and text/cell edits,11actualPG/private UI; trusted metadata/approval and real corpus remain |
| CH038 | 38 RAG/STRUCTURED/BOTHclassifier | IMP-01, STR-01 | PARTIAL: fixed candidates/uninstalled schema→RAG/noDDL/noautopublish GREEN; strict private draft and actualUI retain all3modes/seven codes; installed mappers/atomic BOTH remain |
| CH039 | 39 Versionresolver | IMP-03 | PLANNED: replacement/additional/historical/conflict/races/history |
| CH040 | 40 AMENDS | IMP-03 | PARTIAL: relationshipschemaมี; base+activeamendmentretrieval/publicationUIpending |
| CH041 | 41 Structuredmapper | STR-01/02 | PLANNED: fixedregistryall7 from§12 แม้ตัวอย่าง§41ละsystems |
| CH042 | 42 Unknownstructured | IMP-01, STR-01 | COMPONENT_PASS: analyzer preserves table/candidate but uninstalled schema→RAG/review flag/noDDL; registry/approval/BOTH remain |
| CH043 | 43 PDFparser | IMP-01 | COMPONENT_PASS: scoped Luna max synthetic direct+supervisedPDF10tests and actualPG malformed-child FAILED retention; real Thai/fonts/OCR/corpus/production supervision remain; [report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md) |
| CH044 | 44 URLimport | IMP-01 | COMPONENT_GREEN: officialHTTPS/freshmixedDNS/pinnedTLSoptions/redirect/decompressedlimits/deadline/provenance/queryallowlist+scopedLunareview; actualwireTLS/livecorpus evidencepending |
| CH045 | 45 Checksum | IMP-01/03 | PARTIAL: immutableSHA/dedup/concurrency and encrypted edit/history/byte-exact original retained in actualPG/browser; approved-version publication receipt remains |
| CH046 | 46 KnowledgeDashboard | IMP-04 | PARTIAL: SUPER_ADMIN private import list/preview/edit/review draft UI and21role/browser groups PASS; family/current/history/version/approval UI remains |
| CH047 | 47 Importpage | IMP-01/02/04 | PARTIAL: all5format/URL input controls/private located preview/sensitive warnings/reason-bound page+cell edits/conflict comparison; actual HTML21browser groups include incomplete private review/warning/conflict UX PASS; complete format/corpus/approval acceptance remains |
| CH048 | 48 ImportAPI | IMP-01/02 | PARTIAL: private staging/list/detail/original/analyze/preview/edit/sameorigin/auth/body/CAS, actualPG/Storage/browser/build PASS; review/approval/publication remains |
| CH049 | 49 AnalyzeAPI | IMP-01/02 | COMPONENT_PASS: authorizedsupervisedparser/analysis→encryptedimmutable located preview/strictCAS/privateAPI,11actualPG/route6/actualprivateUI; versionresolver/structuredmapper/approval/corpus remain; [report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md) |
| CH050 | 50 ApproveAPI | IMP-03, STR-02 | PARTIAL prerequisite: independent encrypted review drafts/three-counter CAS/privateAPI12PG+schema10/route6 and21actualbrowser groups PASS, full1235unit/135PG/type/lint/build; actual approval/familylocks/atomicversion+BOTHpublication still pending; [report](../reports/IMP_REVIEW_DRAFT_REPORT.md) |
| CH051 | 51 TicketDashboard | M4, ADV-03 | COMPONENT_EVIDENCE: scopedfilters/list/browser; overviewanalyticsremaining |
| CH052 | 52 TicketDetail | M4, ADV-05 | PARTIAL: messages/history/actions/deliverypermissionsมี; AIstaffassist/similarissuespending |
| CH053 | 53 StaffReply | M4 | COMPONENT_EVIDENCE: authorization/state/message/outbox/audit/idempotency |
| CH054 | 54 StaffOA | M3/M4, ADV-01 | PARTIAL: signedStaffingress/commands/scopedalertscomponent; bindingflow/liveUXpending |
| CH055 | 55 Similarissues | ADV-02 | PLANNED: meaning/context/department/time/privacy thresholds |
| CH056 | 56 Incidentdetector | ADV-02 | PLANNED: backendrules/grouping/status/linkedtickettests |
| CH057 | 57 Severity | ADV-02 | PARTIAL: priorityenum/validationมี; deterministicaggregaterules/UIpending |
| CH058 | 58 Loadingindicator | ADV-04 | PLANNED: LINEloadingHTTPbounds/permission/firstreplytests |
| CH059 | 59 ReplyvsPush | M4/M6, ADV-04 | PARTIAL: expiry/outboxdispatchมี; deadline/freeprovider/latehumanliveflowpending |
| CH060 | 60 Privacy | all | COMPONENT_EVIDENCE: anonymouscode/encryptedidentity/rolefixtures; imports/newUIcontinuechecks |
| CH061 | 61 Sensitiveimport | IMP-01/03 | PARTIAL: categorydetector/qualitywarnings/privateencryptedoriginals/Storageanon+authenticateddenialGREEN; redaction/reanalysis/publicapprovalgateandallformatsintegration pending |
| CH062 | 62 Sourceauthority | M6, IMP-03, STR-02 | PARTIAL: authority/filterretrievaltests; approvedrealversion/conflict/amendmentremaining |
| CH063 | 63 OfficialYRU sources | DOC-01, IMP-01/04 | PARTIAL: collectedcatalogprovenanceมี; domains/sourceauthoritymustreviewbeforepublish |
| CH064 | 64 Initialfamilies19 | M6, IMP-04 | PARTIAL: familyschema/corpus19categoriesมี; approvedfamilydatasetcoverageauditpending |
| CH065 | 65 Departments9 | M1/M2 | COMPONENT_EVIDENCE: supabase/seed.sql, guardedDONOTHINGseed andPGfixtures; nooverwritehumanrecords |
| CH066 | 66 Testcases | all, FINAL-01 | PARTIAL: router/state/filter/fallback/spamcomponentsมี; importversioning/freeUX/fullflowsremaining |
| CH067 | 67 README13topics | DOC-01, FINAL-01 | DOC_COMPLETE: README/localsetup/finalchecklist covertopics; finalimport/deploycommandspendingimplementation |
| CH068 | 68 Phaseorder | all | TRACKED: M1–M9 map7phases; PRVreopenbeforeM7 |
| CH069 | 69 FlowA–F | FINAL-01 | PENDING: businessflowtableด้านล่าง; nofullV1claim |
| CH070 | 70 Forbidden18actions | all | TRACKED: AGENTS/design/matrixinvariants; reverifynewcode/DB/UI |
| CH071 | 71 Agentworkflow | DOC-01/all | TRACKED: taskIDs/source/files/acceptance/reportก่อนimplementation |
| CH072 | 72 Incrementalphasework | DOC-01/all | TRACKED: noallsubsystemparallelwithoutcontracts/gates |
| CH073 | 73 FutureextensionsNOTV1 | all | OUT_OF_V1: StudentSSO/SIS/grades/payments/localLLM/unrestrictedcrawl/autopublish/Hermesmandatory |
| CH074 | 74 Architecture summary | DOC-01/all | TRACKED: systemdesign+diagrams, partialimplementationexplicit |

## คำยืนยันล่าสุด / ต้นฉบับที่ต้องไม่ตกหล่น

| Requirement | แหล่งและ acceptance | Linked tasks / requirement coverage |
|---|---|---|
| USR-FREE | ภาพรวม§22,32–36,42–43 + ล่าสุด: startupgeneration/embedding/testfree, noautomaticpaidfallback, paidlaterUIexplicitopt-in | PRV-01/02/05 PARTIAL: cost/runtime/probe/free configured fixture GREEN; final/live remain |
| USR-ORDER | ล่าสุด + ภาพรวม§33–34: Provider AND Model ขึ้น/ลง, keyboard/mobile, atomicrevisionguardedorder, actualfallbackpreview | PRV-03 AUTOMATED_COMPLETE: actual save/reload/purpose/focus/browser/cooldown preview GREEN |
| USR-STATUS | ล่าสุด + §35–36/master§15: HTTP/outcome/action/latency/timeต่อmodel, actual200/nulltimeout, no providerbadgeแทนmodelresult | PRV-04 PARTIAL: actual persisted runtime/probe HTTP+invalid200/nulltimeout GREEN; final edge gates remain |
| USR-QUOTA | ล่าสุด: near/exhausted/unknown from verifiedcounter/scope/unit/window; HTTPaloneไม่บอกremaining; key/accountsharedต้องlabel | PRV-04 AUTOMATED_COMPLETE/MANUAL_PENDING: reader/storage/shared-near UI/normalized cooldown hint GREEN; live counters/account checks pending |
| USR-TEST | ล่าสุด: selectedmodeltestbutton, freepolicy/boundedprobe/nofallback/safeerror/stalerevision; metadataแยกinference | PRV-04 PARTIAL: pure24/PGleased selected-only/admin+buttons GREEN; fullAPI final coverage remain |
| USR-UX | ล่าสุด: productminimal, scanablemodelrows/progressivesettings/consistency/desktopmobilekeyboard QA ใช้skillimpeccable | PRV-03/04 PARTIAL: actual desktop/mobile/zoom/keyboard screenshot QA+detector GREEN ดู[report](../reports/PRV_OBSERVATIONS_COMPONENT_REPORT.md) |
| USR-UI | ภาพรวม§32: addprovider/model/baseURL/key/enable/priorityผ่านUIโดยไม่แก้codeทุกinstance | PRV-02/03 AUTOMATED_COMPLETE: compatible instance configured through UI/PG/public-DNS-pinned TLS, FREE_ONLY UNKNOWN blocks; new protocol still needs code |
| USR-DOC | ล่าสุด: อ่านสเปคจริงและจัด `.md` ก่อนcode; sourceprecedence/design/tasks/evidence/agentsต้องชัด | DOC-01 COMPLETE; planninggateไม่ใช่appacceptance |
| USR-EMB-LOCAL | [5 October source](sources/2026-10-05-local-e5-embedding.md): existing cache→D: offline E5 CPU/384/query+passage/normalized; private configurable FastAPI/server client/pgvector; generation UI/read-only health; real Thai/English/passage/regression | EMB-01…05 COMPONENT_PASS; [report](../reports/LOCAL_E5_EMBEDDING_REPORT.md): D-only0network/real384HTTP/typedPG/6browser/1197unit/112integration/22replay/RLS/advisors/type/lint/build. No registry model needed; full import/RAG/V1/production remains pending |
| USR-IMPORT5 | master§0(17): PDF/DOCX/XLSX/CSV/URL ทั้งหมด ไม่จบที่PDF+HTMLslice | IMP-01/02 PARTIAL: acceptedacquisition/staging/privateStorage; ZIP23/rootselfreview, XML16/package26/XLSX30 and nativechild8/4formatdispatch3 focused PASS. DOCX/PDF team source/review/allformat gates active; extractionstaging/locations→citations/review/publication/UI remain; [parser evidence](../reports/IMP_PARSER_COMPONENT_REPORT.md) |
| USR-AMENDS | versioning§16 + master§40: base+allactiveamendments; additional≠replace | IMP-03 PARTIALschemaonly |
| USR-WEB | ภาพรวม§27: universityDB→RAG→officialsite→Internet; noforeignuniversityrules/noarbitrarycrawl | ADV-05 PLANNED; exacttoolscopeplanก่อนcode |
| USR-RICHMENU | ภาพรวม§20เป็น source proposal: primaryLINEentry/menu แยกcontextquickreply; V1 inclusion ยังต้อง decision | ADV-05: OPTIONAL / UNDECIDED ไม่ถือเป็นconfirmedmandatoryrequirement |
| USR-STAFFASSIST | ภาพรวม§14: AIสรุป/ค้น/แนะนำระหว่างHUMANแต่staffกดส่งเอง | ADV-05 PLANNED; noautomaticstudentreply |
| USR-DASHBOARD | ภาพรวม§30–31: Overviewรวม8metrics + Tickets/Incidents/Departments/Knowledge/Activities/Providers/Models/Fallback/Usage/Analytics/Logs/Settings รวม13modules | ADV-01…05 PARTIAL; currenttickets/providersonlyไม่ครบ |

## Flow A–F — Full V1 acceptance

Coverage ในตารางด้านบนเป็นสถานะของ requirement รวม ไม่ใช่การรับทั้ง milestone. Provider/free RAG มี component evidence แต่ compatible transport/cooldown/final/live gatesยังขาด. สถานะ taskล่าสุดให้อ่าน task board

| Flow | Test behavior | Evidence ปัจจุบัน / งานคงเหลือ |
|---|---|---|
| FLOW-A FAQ | เทียบโอน → approvedRAG → answer/citation → no ticket | controlledRAGfixtureมี; actualapprovedPDF/freeprovider/reallinepending PRV-05/IMP-04/FINAL-01 |
| FLOW-B Troubleshooting | Wi-Fi → contextquestion → officialguide → solved → no ticket | producerclarificationcomponentsมี; actualmulti-turnfreeguide/solveconfirmationpending RAG-01/FINAL-01 |
| FLOW-C Escalation | unresolvedWi-Fi → confirmedITticket → scopedStaffnotification | M4/receipts/notificationfixturesมี; freeAI→ticket+boundrealStaffOA pending ADV-01/FINAL-01 |
| FLOW-D Human | staffaccept → HUMAN → staffquestion/userreplysamecase → resolve → close | actualPG/HTTP/browsercomponentflowsมี; realOAfullticketcyclepending FINAL-01 |
| FLOW-E NewtopicduringHUMAN | Registrationcase remainsactive while libraryquestion gets newAIconversation | pure/controlledmulti-contexttestsมี; freecurrentlibrarycitation+realOAwhileHUMANpending RAG-01/FINAL-01 |
| FLOW-F Documentupdate | calendar2568 → import2569→family/conflictpreview→approve→oldsuperseded→newcurrent→answer2569 | current/historyretrievalfixturesมี; completeimport/version/structured/BOTHapprovalpending IMP-03/STR-02/FINAL-01 |

## หลักการอัปเดต matrix

เมื่อ acceptance ผ่านเพิ่ม datedreport/command/source scope และเปลี่ยน row อย่างเจาะจง ไม่เปลี่ยนทุก chapter เป็น completeจาก `pnpm build`. Newrequirementเพิ่ม USR row และ linkedtaskก่อนcode. ชื่อทางกายภาพที่ต่างจากตัวอย่างguideต้องเขียน mapping/evidence; ห้ามเอาชื่อไฟล์ที่เหมือนกันเป็นหลักฐานว่า behaviorครบ
