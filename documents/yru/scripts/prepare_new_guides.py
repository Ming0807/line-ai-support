import json
import re
from archive_sources import ROOT

source = next(x for x in json.loads((ROOT/'01-academic/new-index-manifest.json').read_text(encoding='utf-8')) if x['title']=='citizen_guides_new_site')
links_path = next((ROOT/'01-academic/guides').glob('citizen_guides_new_site_*.links.json'))
links = [x for x in json.loads(links_path.read_text(encoding='utf-8')) if 'drive.google.com/file/d/' in x['url']]
items = []
for link in links:
    title = link['title']
    family = 'TRANSFER_GUIDE' if re.search('เทียบโอน|ยกเว้น',title) else 'TRANSCRIPT_GUIDE' if re.search('Transcript|รายงานผลการศึกษา',title) else 'CERTIFICATE_GUIDE' if re.search('ใบรับรอง|ปริญญาบัตร',title) else 'SPECIAL_COURSE_GUIDE' if 'พิเศษ' in title else 'COURSE_WITHDRAWAL_GUIDE' if 'ยกเลิก' in title else 'REGISTRATION_GUIDE'
    items.append(dict(title=title,source_url=link['url'],source_page_url=source['source_url'],category='guides',family_code=family,recommended_storage_mode='BOTH',notes='Official newer-site service guide; index publication date is not document effective date.'))
(ROOT/'01-academic/new-guides-seeds.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
print('New-site guide links:',len(items))
