"""Bounded public-document collector used for this research session, not app import code."""
import concurrent.futures
import hashlib
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 40 * 1024 * 1024

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.text, self.anchor, self.skip = [], [], None, 0
        self.anchor_tag = None
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag in ('script', 'style'): self.skip += 1
        click = re.search(r"window\.open\(['\"]([^'\"]+)['\"]", data.get('onclick', ''))
        if click or tag == 'a':
            self.anchor = [click.group(1) if click else data.get('href', ''), []]
            self.anchor_tag = tag
        if tag in ('p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3'): self.text.append('\n')
        if tag in ('td', 'th'): self.text.append(' | ')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        if tag == self.anchor_tag and self.anchor is not None:
            self.links.append({'url': self.anchor[0], 'title': ' '.join(self.anchor[1]).strip()})
            self.anchor = None
            self.anchor_tag = None
    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)
            if self.anchor is not None: self.anchor[1].append(data.strip())

def normalize(url):
    parts = urllib.parse.urlsplit(url.strip())
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if not k.startswith('utm_')]
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe='/:@!$&\'()*+,;=-._~')
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, urllib.parse.urlencode(query), ''))

def collect_one(item):
    record = dict(item)
    record.update(fetched_at=datetime.now(ZoneInfo('Asia/Bangkok')).isoformat(), review_status='PENDING_REVIEW', is_current=None)
    try:
        url = normalize(item['source_url'])
        record['source_url'] = url
        host = urllib.parse.urlsplit(url).hostname or ''
        if not (host == 'yru.ac.th' or host.endswith('.yru.ac.th') or host == 'drive.google.com'):
            raise ValueError('URL outside bounded YRU/public Drive source set')
        request_url = url
        if host == 'drive.google.com':
            match = re.search(r'/file/d/([^/]+)', url)
            file_id = match.group(1) if match else dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query)).get('id')
            if not file_id: raise ValueError('not a Drive file link')
            request_url = 'https://drive.usercontent.google.com/download?' + urllib.parse.urlencode({'id': file_id, 'export': 'download'})
        req = urllib.request.Request(request_url, headers={'User-Agent': 'Mozilla/5.0 YRUHelpdeskDocumentResearch/1.0'})
        limit = min(int(item.get('max_bytes', MAX_BYTES)), 500 * 1024 * 1024)
        timeout = int(item.get('download_timeout', 45))
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(limit + 1)
            mime = response.headers.get_content_type()
            charset = response.headers.get_content_charset()
            record['resolved_url'] = response.url
        if host == 'drive.google.com' and b'Google Drive - Virus scan warning' in raw:
            # Follow the public download form only; never execute page JavaScript.
            warning = raw.decode('utf-8', errors='replace')
            form = re.search(r'<form[^>]*id="download-form"[^>]*action="([^"]+)"', warning)
            inputs = dict(re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', warning))
            if not form or form.group(1) != 'https://drive.usercontent.google.com/download' or inputs.get('id') != file_id:
                raise ValueError('unexpected Drive confirmation form')
            confirmed = form.group(1) + '?' + urllib.parse.urlencode(inputs)
            with urllib.request.urlopen(urllib.request.Request(confirmed, headers={'User-Agent':'Mozilla/5.0'}), timeout=timeout) as response:
                raw = response.read(limit + 1)
                mime = response.headers.get_content_type()
                record['resolved_url'] = response.url
        if len(raw) > limit: raise ValueError('file exceeds configured bounded download size')
        pdf_expected = bool(re.search(r'\.pdf(?:\?|$)', url, re.I)) or host == 'drive.google.com'
        if pdf_expected and not raw.lstrip().startswith(b'%PDF-'): raise ValueError('expected PDF; response is not a PDF')
        digest = hashlib.sha256(raw).hexdigest()
        slug = re.sub(r'[^\w\-]+', '_', item.get('filename') or item['title'], flags=re.UNICODE).strip('_')[:85]
        target_dir = ROOT / '01-academic' / item.get('category', 'other')
        target_dir.mkdir(parents=True, exist_ok=True)
        if raw.lstrip().startswith(b'%PDF-'):
            extension = '.pdf'
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(raw), strict=False)
            record['page_count'] = len(reader.pages)
            sample = '\n'.join(p.extract_text() or '' for p in list(reader.pages)[:3])
            record['sample_text_characters'] = len(sample)
            record['text_quality'] = 'needs_ocr_or_font_review' if len(sample.strip()) < 120 else 'text_extractable_sample'
        else:
            extension = '.html'
            page = raw.decode(charset or 'utf-8', errors='replace')
            parser = PageParser()
            parser.feed(page)
            content = re.sub(r'\n[ \t]*\n+', '\n\n', ''.join(parser.text)).strip()
            if len(content) < 100: raise ValueError('empty/short HTML response')
            record['text_quality'] = 'html_snapshot_needs_main_content_review'
        target = target_dir / (slug + '_' + digest[:8] + extension)
        target.write_bytes(raw)
        record.update(local_path=target.relative_to(ROOT).as_posix(), bytes=len(raw), sha256=digest, content_type=mime, download_status='downloaded')
        text_path = target.with_suffix('.txt')
        if extension == '.pdf':
            try:
                subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', str(target), str(text_path)], check=True, capture_output=True, timeout=60)
                if not text_path.read_text(encoding='utf-8').strip(): record['text_quality'] = 'needs_ocr_or_font_review'
            except Exception as exc:
                text_path.write_text(sample, encoding='utf-8')
                record['extraction_note'] = 'Only first three pages extracted: ' + str(exc)
        else:
            text_path.write_text(content, encoding='utf-8')
            links = [{'title': l['title'], 'url': normalize(urllib.parse.urljoin(record['resolved_url'], l['url']))} for l in parser.links if l['url']]
            target.with_suffix('.links.json').write_text(json.dumps(links, ensure_ascii=False, indent=2), encoding='utf-8')
        record['text_path'] = text_path.relative_to(ROOT).as_posix()
        record.setdefault('academic_year', None)
        record.setdefault('recommended_storage_mode', 'RAG')
        record.setdefault('notes', 'Current/effective status requires content and audience review; not auto-published.')
    except Exception as exc:
        record.update(download_status='failed', error=str(exc))
    return record

def main():
    items = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    output = Path(sys.argv[2])
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for rec in pool.map(collect_one, items):
            results.append(rec)
            print(json.dumps({'title':rec['title'], 'status':rec['download_status'], 'error':rec.get('error')}, ensure_ascii=False), flush=True)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'total':len(results), 'downloaded':sum(r['download_status']=='downloaded' for r in results)}), flush=True)

if __name__ == '__main__': main()
