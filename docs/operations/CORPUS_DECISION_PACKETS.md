# ชุดตรวจแหล่งข้อมูลสาธารณะ YRU — root รับผิดชอบต่อ

อัปเดต26ตุลาคม2026 ตาม DEC-172: ผู้ใช้ยืนยันการใช้ข้อมูลสาธารณะและอาจารย์อนุญาตแล้ว **ไม่ต้องขออนุมัติจากเจ้าของข้อมูลซ้ำ** Root ตรวจต้นฉบับและใช้ review/publication ปกติได้ งานด้านล่างเป็นงานค้นหลักฐาน/ตรวจข้อมูลของทีม ไม่ใช่แบบสอบถามที่ผู้ใช้ต้องกรอกก่อนเริ่มงาน

การเตรียม extraction/transcription เดิมครบ9รายการอยู่ใน [technical review](../../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md) ซึ่งเก็บเป็นหลักฐานตามวันที่เดิม แผนปัจจุบัน: [ROOT-CORPUS-PUBLIC-01](../superpowers/plans/2026-10-26-public-corpus-review.md)

## สถานะปัจจุบัน ROOT-STR-CORPUS-01 — 28 ตุลาคม 2026

Normal DEVELOPMENT มี16 approvedPUBLIC: 15RAGเดิมและ1STRUCTUREDฉบับถอดข้อมูลบริการห้องสมุด. ใช้ครอบครัวLIBRARY_GUIDEเดิมแต่คนละversionstream ไม่แทนที่HTMLเดิม. RootตรวจretainedrawSHAและexactpublishedextraction/review receiptของต้นฉบับ [หน้าติดต่อห้องสมุด](https://library.yru.ac.th/contact), HTMLblocks55/57/59–61 แล้วนำเข้าผ่านUPLOAD CSV/review4/Mapping1/5attestations/normalapprove. ไม่อ้างว่าCSVเป็นไฟล์downloadจากมหาวิทยาลัย.

| ข้อมูลที่ตรวจจากต้นฉบับ | ค่าที่เผยแพร่ |
| --- | --- |
| ชื่อ | ศูนย์บรรณสารสนเทศ |
| สถานที่ | อาคารบรรณราชนครินทร์ มหาวิทยาลัยราชภัฏยะลา |
| วันธรรมดา | จ-ศ 08.00-17.00 น. |
| เสาร์–อาทิตย์ | ส-อา 08.30-16.30 น. |
| ข้อยกเว้น | หยุดทุกวันหยุดนักขัตฤกษ์ |
| โทรศัพท์หน่วยงาน | 073-299675 ต่อ 23300 |
| อีเมล / วันที่เริ่มมีผล | null: ไม่เดาจากplaceholderหรือวันตรวจทาน |

service_codeเป็นรหัสที่ผู้ตรวจตั้งเพื่อค้นภายใน ไม่ใช่รหัสทางการและไม่ส่งเป็นข้อเท็จจริงให้model. Manifestผูกทุกค่ากับข้อความจริง ส่วนCSVยังมีพิกัดเซลล์ของตนเอง. Normalreceipt/replay/currenttypeddiscovery/historicalexclusionผ่าน; university_services1แถว/อีก6dataset0; เอกสารเดิม15ฉบับไม่เปลี่ยน. สคริปต์ปฏิบัติการครั้งแรกหยุดก่อนsaveที่whitelistคำเตือน: analyzerเดาdatasetจากชื่อCSVไม่ได้และแจ้งSTRUCTURED_SCHEMA_UNAVAILABLE. RootตรวจcanonicalMapping1 publicationAvailable=trueแล้วบันทึกFALSE_POSITIVEพร้อมเหตุผลตรงคำเตือน; คงfindingและเงื่อนไขruntimeไว้ทั้งหมด. ไม่แก้productguardเพื่อให้ผ่าน.

Current3418unit/252files,150focused,114ownedPG/47migrations/exactcleanup,type/changedlint/build879matchinginputsผ่าน. หลักฐานprivateอยู่ `.superpowers/staging/root-library-service-20261028/` และ `root-transcription-*.log`; ไม่commitoriginals/credentials. Actual Luna high authoredpuretests, Luna maxตรวจdesign/finalsourceguardsเฉพาะขอบเขต และLuna highตรวจcandidateถัดไปแบบอ่านอย่างเดียว; rootทำimplementation/normalDB/acceptance. การทดสอบจริงGemini/LINE/Hermes/FlowA–Fยังไม่ทำรอบนี้.

Candidateaudit: ปฏิทินเกินหน่วยกิต2569มีหลักฐานชัดที่สุดถัดไป แต่typedcalendarต้องออกแบบscopeปกติ/กศ.บป./การแปลงวันที่/parentproofและrefreshแยกจากpermissionGUIDE/servicesปัจจุบัน. YRU027ไม่มีeffective dateที่ยืนยัน; YRU010/011ยังมีdategroupsขัดแย้ง; fees/transfer/รุ่นยังมีauthority/applicabilitygaps. คงRAGที่ตรวจแล้วและงดtypedfactsที่ไม่มีหลักฐาน. ทั้ง7schemasต้องพร้อมใช้งาน ไม่ได้แปลว่าต้องแต่งข้อมูลให้ครบ7ตาราง. Sourceversionrefreshใช้จริงเมื่อพบต้นฉบับใหม่ที่พิสูจน์ได้ ไม่สร้างreplacementจำลองเพื่อปิดFlowFจริง.

## Checkpoint ROOT-CORPUS-PUBLIC-04 — 27 ตุลาคม 2026 (historical)

Root ตรวจและเผยแพร่ชุดเริ่มต้น13รายการในขอบเขตที่ตรวจทานได้ รวมกับระเบียบแม่บทและปฏิทินเกินหน่วยกิตเพิ่มเติมเป็น15 approved PUBLIC ในฐานพัฒนา ตัวเลขนี้นับเอกสาร RAG ไม่ได้ยืนยันว่าทุกข้อมูลในต้นฉบับใช้ตอบได้ ทุกหลักสูตร/รุ่นครอบคลุม หรือ structured dataset มีข้อมูลครบ ทั้ง7structuredtablesยัง0แถว Root ตรวจเอง ไม่มี independent reviewer รอบนี้

| รายการที่เพิ่มรอบนี้ | ขอบเขตที่ตรวจและเผยแพร่ |
| --- | --- |
| YRU010 ปฏิทินภาคปกติ2569 | 14 chunks จาก6หน้า ตัดทั้งช่อง W ภาค2 ที่ปีขัดกัน พร้อมหมายเหตุและเก็บต้นฉบับ/manifest |
| YRU011 ปฏิทิน กศ.บป.2569 | 13 chunks จาก6หน้า งดช่อง/กลุ่มวันที่ขัดกัน ได้แก่ ลาพัก/พ้นสภาพ, IM, สอบปลายภาค2 และตารางสอนฤดูร้อนปีไม่ตรง เก็บส่วนอื่นและหมายเหตุที่ตรวจได้ |
| YRU007 ค่าธรรมเนียม | 5 chunks จากหน้าเว็บสด แยก4คอลัมน์ที่แสดงจริงสำหรับรุ่น62–64/65ขึ้นไปและภาคปกติ/พิเศษ ไม่เผยคอลัมน์เก่าที่ซ่อนหรือเลื่อนราคา และไม่ใช่ใบแจ้งหนี้รายคน |
| YRU166 ดัชนีประกาศกิจกรรม | 5 chunks จำกัด10รายการล่าสุดที่ตรวจชื่อและลิงก์ เป็นสารบัญค้นประกาศ ไม่ใช่หลักเกณฑ์ครอบทุกกรณี |
| YRU047 คู่มือเทียบโอน | 2 chunks จากภาพขั้นตอน1หน้า ลำดับรวม43วันเป็นมาตรฐานคู่มือ ไม่รับรองกำหนดรายคน งดใช้ช่วงเปิดระบบที่ขัดกับปฏิทินปัจจุบัน ค่าธรรมเนียม50บาทต่อหน่วยกิตตรวจประกาศ2565ข้อ7.9และระบุขอบเขตผู้เข้าศึกษา2565ขึ้นไป |
| YRU149 กิจกรรมเสริมหลักสูตร | 22 chunks จากภาพ6หน้า จำกัดรุ่นเข้าศึกษา2568/ปริญญาตรี/ภาคปกติ แม้ต้นฉบับเขียน2568เป็นต้นไป งดใช้ยอดรวมและเงื่อนไขเทียบโอนข้อ4/ช่องแถว7ที่ขัดกัน; เกณฑ์รายปีข้อ8ไม่ได้แนบจึงยังยืนยันไม่ได้ วันที่6มิ.ย.2568เป็นวันที่ประกาศ ไม่สมมติวันเริ่มมีผล |

แต่ละรายการมี normalreview/receipt/replay/current located E5 ผ่าน; ตรวจ exclusion ผิดปี/ประเภทหรือรุ่นตามข้อมูลที่มี และ current-reviewed ไม่ใช้ค้นย้อนหลัง. Read-only audit ตรวจจำนวน chunks, ข้อความกลุ่มขัดกันตามmanifestไม่ปรากฏ และหมายเหตุจำกัดของYRU149ยังอยู่. หลักฐานและต้นฉบับเก็บใน ignored `.superpowers/staging/root-corpus-publication-closeout-20261026/` ไม่ commit ข้อมูลส่วนตัว/credentials. Migration45ตรวจdigestเอกสารเดิมก่อน/หลังเท่ากัน;3330unit, type/lint/build และ17affectedownedPGผ่าน. ไม่อ้างการทดสอบGemini/LINE/Hermesจริงจากการเผยแพร่.

หัวข้อข้อเท็จจริงและสถานะด้านล่างเก็บตามวันที่เดิม; จำนวนรายการค้างเดิมถูกแทนด้วยสถานะข้างต้น ไม่ได้ลบหลักฐานประวัติ.

## ข้อเท็จจริงที่ตรวจเพิ่มแล้ว

| รายการ | ผลตรวจ / สิ่งที่ต้องรักษา |
| --- | --- |
| YRU-010 ภาคปกติ / YRU-011 กศ.บป. | [สารบัญทางการ](https://acdservice.yru.ac.th/page/41) ยังแสดงทั้งสองฉบับปี2569แยกกัน ชื่อไฟล์ระบุแก้ไข8มิ.ย.69และ3ส.ค.69; ลงนาม28ม.ค.2569 ไม่ใช้วันที่บทความแทนวันออกPDF มีปฏิทินสาขาการจัดการธุรกิจการค้าสมัยใหม่แยก จึงไม่เหมารวมทุกหลักสูตร |
| YRU-034 แบบเกิน22หน่วยกิต | ต้นฉบับสดตรงSHA/93,965bytes Rootตรวจภาพทั้ง2หน้า เป็นขั้นตอนและแบบฟอร์มว่าง ไม่ใช่ข้อมูลนักศึกษาที่กรอกแล้ว ไม่สรุปสิทธิ์ทั้งหมดจากชื่อ >22 หรือช่องเลือกหลักสูตร [สารบัญแบบฟอร์ม](https://acdservice.yru.ac.th/page/27) มีปฏิทินเกินหน่วยกิต2569แยก ซึ่งต้องอ่านก่อนตอบช่วงยื่น |
| YRU-027 ขอหลักฐานสำคัญทางการศึกษา | ต้นฉบับสดตรงSHA/104,290bytes Rootตรวจภาพครบ1หน้า เป็นแบบฟอร์มว่างสาธารณะ ใช้ชื่อที่พิมพ์บนหน้า; embeddedPDFtitleที่เป็นเทียบโอนไม่ตรงเนื้อหา ชื่อไฟล์บอกปรับก.พ.69 แต่ไม่ระบุวันออก/วันเริ่มใช้ ช่องว่างชื่อ/รหัส/โทรศัพท์ไม่ใช่รายชื่อนักศึกษาจริง |
| YRU-182 ห้องสมุด | [หน้าติดต่อทางการ](https://library.yru.ac.th/contact) ระบุอาคารบรรณราชนครินทร์ โทร073-299675ต่อ23300 จ.–ศ.08:00–17:00 ส.–อา.08:30–16:30 ปิดวันหยุดราชการ เบอร์นี้เป็นช่องทางหน่วยงานสาธารณะ ไม่ต้องถามผู้ใช้ว่าเผยได้หรือไม่ วันที่headerเปลี่ยนตามการเรียกหน้า ไม่ใช่วันประกาศ |
| YRU-047 คู่มือเทียบโอน | [สารบัญทางการ](https://eduservice.yru.ac.th/page/?view=info_guide) ยังลิงก์คู่มือ2568; PDF1หน้าพิมพ์ปรับปรุง21มี.ค.2568และรวม43วัน เป็นการเทียบโอนผลการเรียนในระบบ ไม่เหมารวมกับ30/15วันของการเทียบความรู้/ประสบการณ์ คู่มืออ้างอัตรา2565และประกาศดำเนินการ2566 ต้องอ่านก่อนกล่าวอัตราว่าเป็นอัตราปัจจุบัน |
| YRU-007 ค่าธรรมเนียม | [หน้าทางการ](https://eduservice.yru.ac.th/page/?view=fee) แยกกลุ่ม62–64/65เป็นต้นไปและปกติ/พิเศษ ต้องตรวจDOMสดเทียบarchiveและเครื่องมืออัตรา ไม่เลื่อน4ค่าที่เห็นในแถวผิดรูปเข้า6ช่อง หรือเผยค่าcommentที่ซ่อนไว้ |
| YRU-149 / YRU-166 กิจกรรมนักศึกษา | [สารบัญทางการ](https://stddev.yru.ac.th/th/?page=rule&t=n4) มีทั้งประกาศ2568เดิมและประกาศแผนการเรียน3ปี2569แยกกัน ฉบับใหม่ไม่ใช่หลักฐานยกเลิกฉบับเดิมทุกหลักสูตรโดยอัตโนมัติ ดัชนีเป็นที่ค้นประกาศ ไม่ใช่กฎเดียวครอบทุกcohort ข้อ4/แถว7และเกณฑ์รายปีของฉบับเดิมต้องคงข้อจำกัด ไม่แก้ตัวเลขเอง |

## ข้อจำกัดที่พบในซอฟต์แวร์ปัจจุบัน

ROOT-CORPUS-PUBLIC-02 / DEC173แก้แล้วสำหรับpublicRAGschema4: `CURRENT_REVIEWED` เก็บeffective datesเป็นnullและบันทึกเวลาreviewจากserverแยกต่างหาก ค้นได้เฉพาะปัจจุบัน ไม่ใช้ตอบhistorical/as-ofและไม่เป็นundatedruleeffects. CALENDARต้องมีacademicYear; yearlessGUIDE/FORMมีglobalcurrent applicabilityตามscopeเดิม. Schema1–3และSTRUCTURED/BOTHเดิมไม่ถูกผ่อนเงื่อนไข

เพิ่มschema4category/basis/reason ที่ผูกกับencryptedreview/source revisionsแล้ว โดยคงdetectorfindingsและFALSE_POSITIVEreason. ตรวจรูปแบบfilledID/grade/name/sensitivecolumnsและpersonal mobile; unsupportedcategories/structuredmodeยังblocked. Rootsource-wide reviewยังจำเป็น ไม่ถือว่าregexพิสูจน์absenceของข้อมูลรายบุคคลได้ทุกกรณี

NormalYRU182และYRU027เผยแพร่แล้วจริงพร้อมreceipt/replay/currentlocatedE5retrievalและhistoricalexclusion; source datesยังnull. ห้องสมุดเก็บmainHTMLblocks54–61เฉพาะส่วนบริการ (ตัดnavigation/footerซ้ำ/obfuscatedemailplaceholder โดยเก็บoriginalและตำแหน่งเดิม)8chunks; แบบฟอร์มแก้titleตามหน้าและglyphขั้นตอนที่ตรวจภาพแล้ว1chunk. PUBLICรวม7; structuredrowsยัง0. เหลือYRU010/011/034/047/007/149/166 ไม่ต้องขอสิทธิ์ใช้ข้อมูลเพิ่ม แต่ต้องทำsource/extraction/mappingอย่างครบถ้วน

## หลักฐานและสถานะ

### ROOT-CORPUS-PUBLIC-03 — 26October root continuation

ผู้ใช้ยกเลิกGLMhandoff. Rootดำเนินการเองและself-review; ไม่อ้างindependentreviewรอบนี้. เพิ่มnormalpublicationจริงอีก2ฉบับ รวมapprovedPUBLIC9:

| เอกสาร | หลักฐานตรวจ / ผลปฏิบัติการ |
| --- | --- |
| YRU034 แบบเกิน22หน่วยกิต | SHA`f7561e468e57f26e65e5e54a1e814c8df7a77627f00dc0a12d480597d84b0fe8`; original2หน้าว่างคงเดิม. แก้page1จากภาพครบทุกขั้น/ลูกศรเห็นชอบและไม่เห็นชอบ; page2คงtextเดิม. Parser3fragments/7emptycellsและBLOCKING warningยังอยู่; exactwarning/page/reason adjudicationตามDEC174. Normalreceipt/replay/5chunks/currentlocatedE5/historicalexclusion PASS |
| ปฏิทินลงทะเบียนเกินหน่วยกิต2569 | แหล่งเพิ่มจากlink24ของ[สารบัญแบบฟอร์ม](https://acdservice.yru.ac.th/page/27). SHA`79652da4841e7124fceb6137573f89f9601c41971e70648332c6e331a9dd0ddf`; rootดูครบ1หน้าสแกน/6แถว/3ภาคเรียน/หมายเหตุ/ผู้ลงนาม. แปลงเลขไทยและชื่อเดือนโดยคงค่า; ช่วงยื่นฤดูร้อนเริ่ม28พ.ย.69ตามภาพ. ใช้ประกาศ12พ.ค.2569เป็นpublishedAtเท่านั้น; effective datesยังnull. ระบุวันที่ประชุมอาจเปลี่ยนตามต้นฉบับ. Normalreceipt/replay/1chunk/currentlocatedE5/historicalexclusion/wrongyear2568และ2570exclusion PASS |

ปฏิทินYRU010/011: rootดูครบ12หน้า พบข้อผิดพลาดในdraftเก่าและสร้างcorrectedcopy9รายการโดยเก็บoldSHA/oldfile unchanged. แก้finalmarkerของภาคปกติ, เลขrowวันหยุดที่ต้นฉบับข้าม5, ตารางweekendที่เดิมนับวันหยุด2–3ม.ค.เป็นสัปดาห์เรียน และรักษาปี69ที่พิมพ์บนsummerheaders. เติมหมายเหตุ1–16/week10ไม่เบิกค่าสอนเกินภาระงานและsummer1–8ตามภาพ. ไม่เผยแพร่fullcalendarsเพราะมีsourceconflicts:

| ตำแหน่งต้นฉบับ | ข้อขัดแย้งที่ห้ามเดาแก้ |
| --- | --- |
| YRU010p1 ช่องWterm2 | เริ่ม24พ.ย.69แต่สิ้นสุด26ก.พ.69 |
| YRU011p4 ช่องIMterm1 | พิมพ์25ต.ค.–23พ.ย.68อยู่ในcalendar2569 |
| YRU011p5กับp6 finalterm2 | ตารางหลัก3–4เม.ย.70; weektable4–5เม.ย.70 |
| YRU011p6 summerheaders | พิมพ์เม.ย./พ.ค./มิ.ย.69 แต่ตารางหลักsummer70 |
| YRU011p2 term2leave | ช่วงขอลาพักถึง17ธ.ค.69 แต่แถวพ้นสภาพเมื่อไม่ลาพักระบุ15ธ.ค.69; ต้องรักษาความต่าง ไม่อนุมานว่าขั้นตอนเดียวกัน |

หลักฐานปัจจุบัน `.superpowers/staging/root-corpus-completion-20261026/`: RED/green/unit/ownedPG/build/currenthash/sourceimage/transcriptioncorrections/conflictmanifest/normalreceipts/retrieval/normalcounts. Private originalsไม่ได้commit. ปฏิทินเฉพาะเรื่องใหม่นี้ไม่ใช่การแก้ขัดแย้งของปฏิทินหลักและไม่ขยายเป็นสิทธิ์เกินหน่วยกิตทุกรณี. ทั้ง7structuredtablesยัง0rows; เหลือ6starteritemsและtypedmappingเป็นงานrootต่อ. ไม่มีการยิงgeneration/Hermes/LINEเพิ่ม

ตรวจเครื่องมืออ้างอิงเบื้องต้นเพิ่มจากarchive: fee2565SHA`1a8d0f0f…`หน้าแรกข้อ1ใช้กับผู้เข้าศึกษา2565เป็นต้นไป และข้อ4ระบุเพดานไม่เกินอัตราตาราง; ไม่ใช่หลักฐานใบแจ้งชำระของทุกคน. Transfer2566SHA`6fa15398…`หน้าแรกข้อ2ผูกกับเกณฑ์มาตรฐานหลักสูตร2548; transfer2568SHA`728110df…`ข้อ2ระบุใช้ตั้งแต่ปีการศึกษา2568เป็นต้นไป. Rootดูเฉพาะหน้าแรก/ท้ายของทั้ง3ฉบับรอบนี้ ไม่อ้างfullinstrumentreviewหรือlivebyteverification และยังไม่publish/ผูกยกเลิก/ตั้งfeeปัจจุบันจากข้อมูลบางหน้า. [สารบัญทางการ](https://eduservice.yru.ac.th/page/?view=aor) เป็นจุดค้นต้นฉบับ ไม่ใช่คำตัดสินว่าlatestdocumentแทนทุกscope

Rootทำsource/image reviewและnormalservice execution; Luna highทำread-only official-source/calendar/forms reviewจริง ไม่ใช่publicationหรือDBacceptanceจากagent ผลปฏิบัติการอยู่ใน `.superpowers/staging/root-public-corpus-20261026/` (ไม่รวมไฟล์ลับในเอกสารนี้) ดูจำนวนdrafts/receiptsจริงที่บอร์ดงาน ไม่ถือว่าsave draftคือpublish และไม่ยิงทดสอบGemini/LINEเพิ่มตามคำสั่งผู้ใช้
