import json
import re
import urllib.parse
from archive_sources import ROOT, PageParser, normalize

indices = json.loads((ROOT / '01-academic/index-manifest.json').read_text(encoding='utf-8'))
items, omitted, seen = [], [], set()
for source in indices:
    path = ROOT / source['local_path']
    parser = PageParser()
    parser.feed(path.read_text(encoding='utf-8', errors='replace'))
    category = source['category']
    for link in parser.links:
        url = normalize(urllib.parse.urljoin(source['resolved_url'], link['url']))
        title = link['title'].strip(' ●\xa0') or urllib.parse.unquote(urllib.parse.urlsplit(url).path.split('/')[-1])
        if not re.search(r'\.pdf(?:\?|$)|drive.google.com/file/d/', url, re.I): continue
        if not link['title'] and category != 'fees': continue
        if re.search('ผลพิจารณา|ผลการพิจารณา|ประกาศรายชื่อ|เสนอรายชื่อ|ปฏิบัติงานของเจ้าหน้าที่|ข้อมูลส่วนบุคคล|บันทึกส่งวาระ|ตัวอย่างวาระ|ERP', title):
            omitted.append({'title': title, 'source_url': url, 'reason': 'individual results, internal staff forms, or outside student-helpdesk document scope'})
            continue
        if category == 'transfer-tables' and not ('ตาราง' in title and '2568' in title): continue
        if category == 'handbooks' and not ('2568' in title or 'ลงทะเบียน' in title): continue
        if category == 'regulations' and not re.search('เทียบโอน|วัดผล|ประเมินผล|สอบ|ลงทะเบียน|ยกเว้น|หน่วยกิต|ปริญญาตรี|จัดการศึกษาระดับ', title): continue
        if url in seen: continue
        seen.add(url)
        family = source['family_code']
        if category == 'guides':
            family = 'TRANSFER_GUIDE' if re.search('เทียบโอน|ยกเว้น', title) else 'TRANSCRIPT_GUIDE' if re.search('Transcript|รายงานผลการศึกษา', title) else 'CERTIFICATE_GUIDE' if re.search('ใบรับรอง|ปริญญาบัตร', title) else 'COURSE_WITHDRAWAL_GUIDE' if 'ยกเลิก' in title else 'SPECIAL_COURSE_GUIDE' if 'พิเศษ' in title else 'REGISTRATION_GUIDE'
        if category == 'forms': family = 'ACADEMIC_CALENDAR' if 'ปฏิทิน' in title else 'REGISTRATION_GUIDE' if 'เกินหน่วยกิต' in title else 'SERVICE_FORM'
        if category == 'regulations': family = 'TRANSFER_REGULATION' if 'เทียบโอน' in title else 'EXAM_REGULATION' if 'สอบ' in title else 'GRADING_REGULATION' if re.search('วัดผล|ประเมินผล',title) else 'ACADEMIC_REGULATION'
        year = re.search(r'25[0-9]{2}', title)
        audience = 'กศ.บป.' if 'กศ.บป.' in title else 'ภาคปกติ' if 'ภาคปกติ' in title else None
        items.append(dict(title=title, source_url=url, source_page_url=source['source_url'], category=category, family_code=family, academic_year=int(year.group()) if year else None, audience=audience, recommended_storage_mode='BOTH' if category in ['calendars','fees','transfer-tables'] or family in ['TRANSFER_GUIDE','TRANSCRIPT_GUIDE'] else 'RAG'))
(ROOT / '01-academic/document-seeds.json').write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
(ROOT / '01-academic/omitted-links.json').write_text(json.dumps(omitted, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'selected': len(items), 'categories': {c:sum(i['category']==c for i in items) for c in sorted(set(i['category'] for i in items))}}, ensure_ascii=False))
