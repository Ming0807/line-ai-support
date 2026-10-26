# ชุดตรวจแหล่งข้อมูลสาธารณะ YRU — root รับผิดชอบต่อ

อัปเดต26ตุลาคม2026 ตาม DEC-172: ผู้ใช้ยืนยันการใช้ข้อมูลสาธารณะและอาจารย์อนุญาตแล้ว **ไม่ต้องขออนุมัติจากเจ้าของข้อมูลซ้ำ** Root ตรวจต้นฉบับและใช้ review/publication ปกติได้ งานด้านล่างเป็นงานค้นหลักฐาน/ตรวจข้อมูลของทีม ไม่ใช่แบบสอบถามที่ผู้ใช้ต้องกรอกก่อนเริ่มงาน

การเตรียม extraction/transcription เดิมครบ9รายการอยู่ใน [technical review](../../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md) ซึ่งเก็บเป็นหลักฐานตามวันที่เดิม แผนปัจจุบัน: [ROOT-CORPUS-PUBLIC-01](../superpowers/plans/2026-10-26-public-corpus-review.md)

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

Rootทำsource/image reviewและnormalservice execution; Luna highทำread-only official-source/calendar/forms reviewจริง ไม่ใช่publicationหรือDBacceptanceจากagent ผลปฏิบัติการอยู่ใน `.superpowers/staging/root-public-corpus-20261026/` (ไม่รวมไฟล์ลับในเอกสารนี้) ดูจำนวนdrafts/receiptsจริงที่บอร์ดงาน ไม่ถือว่าsave draftคือpublish และไม่ยิงทดสอบGemini/LINEเพิ่มตามคำสั่งผู้ใช้
