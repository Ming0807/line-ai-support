"""Merge collection manifests and verify local archive integrity without publishing it."""
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from archive_sources import ROOT

SOURCES = ['01-academic/index-manifest.json','01-academic/document-manifest.json','01-academic/new-index-manifest.json','01-academic/retry-manifest.json','01-academic/new-guides-manifest.json','02-student-affairs/manifest.json','03-it-library/manifest.json','03-it-library/failed-source-attempts.json']
by_url, attempts = {}, []
for name in SOURCES:
    path = ROOT / name
    if not path.exists(): continue
    for original in json.loads(path.read_text(encoding='utf-8-sig')):
        rec = dict(original)
        rec['download_status'] = str(rec.get('download_status','unknown')).lower()
        attempts.append(dict(rec, collection_manifest=name))
        url = rec['source_url']
        previous = by_url.get(url)
        family_codes = set(rec.get('family_codes') or [rec.get('family_code')])
        if previous:
            family_codes.update(previous.get('family_codes') or [previous.get('family_code')])
        rec['family_codes'] = sorted(f for f in family_codes if f)
        if rec['download_status'] == 'downloaded' or url not in by_url or by_url[url]['download_status'] != 'downloaded':
            by_url[url] = rec

records = list(by_url.values())
integrity_errors = []
for index, rec in enumerate(records, 1):
    rec['catalog_id'] = f'YRU-{index:03}'
    rec['review_status'], rec['is_current'] = 'PENDING_REVIEW', None
    rec.setdefault('academic_year', None)
    rec.setdefault('effective_from', None)
    rec.setdefault('effective_to', None)
    title = rec['title']
    if 'ค่าธรรมเนียม' in title: rec['family_code'] = 'TUITION_FEE'
    if 'จิตอาสา' in title: rec['family_code'] = 'VOLUNTEER_ACTIVITY_RULE'
    if (rec.get('local_path') or '').startswith('01-academic/') and 'ลงทะเบียน' in title and 'ปฏิทิน' not in title: rec['family_code'] = 'REGISTRATION_GUIDE'
    if re.search('วัดผล|ประเมินผลการศึกษา|วัดและประเมินผล', title): rec['family_code'] = 'GRADING_REGULATION'
    rec['family_codes'] = sorted(set(rec.get('family_codes', []) + [rec['family_code']]))
    rec['archive_only'] = bool(re.search('ค่าตอบแทน|การประเมินผลการปฏิบัติงาน|ใบสมัครเป็นอาจารย์|การรับสมัครนักศึกษา', title)) or title == 'view'
    if title == 'view': rec['notes'] = 'Untitled footer download; outside verified tuition/helpdesk topic. Retained as archive-only; not a tuition source.'
    if 'index' in title or title.endswith('_new_site'): rec['resource_role'] = 'source_index'
    else: rec['resource_role'] = 'document_or_service_page'
    if rec['download_status'] != 'downloaded': continue
    target = (ROOT / rec['local_path']).resolve()
    if ROOT.resolve() not in target.parents or not target.is_file():
        integrity_errors.append({'catalog_id':rec['catalog_id'], 'error':'missing file or outside archive'})
        continue
    sha = hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()
    if sha != rec['sha256'] or target.stat().st_size != rec['bytes']:
        integrity_errors.append({'catalog_id':rec['catalog_id'], 'error':'checksum or length mismatch'})
    if target.suffix.lower() == '.pdf':
        with target.open('rb') as handle:
            if not handle.read(10).lstrip().startswith(b'%PDF-'):
                integrity_errors.append({'catalog_id':rec['catalog_id'], 'error':'invalid PDF header'})
    text_path = rec.get('text_path')
    if not text_path:
        companion = target.with_suffix('.txt')
        if companion.exists(): rec['text_path'] = companion.relative_to(ROOT).as_posix()
    if rec.get('text_path'):
        text = (ROOT / rec['text_path']).read_text(encoding='utf-8-sig', errors='replace')
        rec['extracted_characters'] = len(text.strip())
        thai = sum('\u0e00' <= c <= '\u0e7f' for c in text)
        rec['thai_characters'] = thai
        rec['average_characters_per_page'] = round(len(text.strip()) / max(1, rec.get('page_count') or 1), 1)
        if target.suffix.lower() == '.pdf' and (len(text.strip()) < 120 or thai < 20 or rec['average_characters_per_page'] < 120 or '\x00' in text):
            rec['text_quality'] = 'needs_ocr_or_font_review'
    rec['integrity_verified'] = True

ROOT.joinpath('manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
ROOT.joinpath('download-attempts.json').write_text(json.dumps(attempts,ensure_ascii=False,indent=2),encoding='utf-8')
ROOT.joinpath('failed-downloads.json').write_text(json.dumps([r for r in records if r['download_status']!='downloaded'],ensure_ascii=False,indent=2),encoding='utf-8')
physical = {}
for rec in attempts:
    if rec['download_status']=='downloaded' and rec.get('local_path'):
        physical[rec['local_path']] = rec
for rec in physical.values():
    path=(ROOT/rec['local_path']).resolve()
    if ROOT.resolve() not in path.parents or not path.is_file():
        integrity_errors.append({'local_path':rec['local_path'],'error':'missing original/alternate snapshot'})
        continue
    with path.open('rb') as handle: sha=hashlib.file_digest(handle,'sha256').hexdigest()
    if sha!=rec['sha256'] or path.stat().st_size!=rec['bytes']:
        integrity_errors.append({'local_path':rec['local_path'],'error':'original/alternate checksum mismatch'})
fields=['catalog_id','title','family_code','academic_year','cohort','audience','download_status','local_path','source_url','source_page_url','bytes','page_count','sha256','text_quality','recommended_storage_mode','review_status','is_current','archive_only','notes']
with ROOT.joinpath('manifest.csv').open('w',encoding='utf-8-sig',newline='') as handle:
    writer=csv.DictWriter(handle,fieldnames=fields,extrasaction='ignore')
    writer.writeheader()
    writer.writerows(records)

def md(value): return str(value or '').replace('|','/').replace('\n',' ')
lines=['# YRU document catalog','', 'รวบรวมวันที่ 4 ตุลาคม 2569 ทุกไฟล์รอตรวจทานก่อนนำเข้า ข้อมูลในตารางเป็น metadata ของแหล่งที่พบ ไม่ยืนยันสถานะใช้บังคับปัจจุบัน','', '| ID | เอกสาร | หมวด | ปี/กลุ่ม | ไฟล์ในเครื่อง | ต้นทาง | คุณภาพข้อความ |', '|---|---|---|---|---|---|---|']
for rec in records:
    local='[เปิดไฟล์](<'+rec['local_path']+'>)' if rec.get('local_path') else 'ดาวน์โหลดไม่สำเร็จ'
    scope=' / '.join(str(v) for v in [rec.get('academic_year'),rec.get('cohort'),rec.get('audience')] if v)
    lines.append('| '+' | '.join([rec['catalog_id'],md(rec['title'])+(' (archive only)' if rec['archive_only'] else ''),md(rec.get('family_code')),md(scope),local,'[แหล่งทางการ]('+rec['source_url']+')',md(rec.get('text_quality'))])+' |')
ROOT.joinpath('CATALOG.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
success=[r for r in records if r['download_status']=='downloaded']
summary={'resources':len(records),'downloaded':len(success),'failed':len(records)-len(success),'pdf':sum(Path(r['local_path']).suffix.lower()=='.pdf' for r in success),'html':sum(Path(r['local_path']).suffix.lower()=='.html' for r in success),'total_bytes':sum(r['bytes'] for r in success),'unique_content_hashes':len(set(r['sha256'] for r in success)),'archive_only':sum(r['archive_only'] for r in success),'needs_ocr_or_font_review':sum(Path(r['local_path']).suffix.lower()=='.pdf' and str(r.get('text_quality','')).lower() in ['needs_ocr_or_font_review','none','low','poor','low/poor'] for r in success),'groups':dict(Counter(r['local_path'].split('/')[0] for r in success)),'integrity_errors':integrity_errors}
summary['physical_source_files'] = len(physical)
summary['physical_html_files'] = sum(Path(r['local_path']).suffix.lower()=='.html' for r in physical.values())
ROOT.joinpath('verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
if integrity_errors: raise SystemExit(1)
