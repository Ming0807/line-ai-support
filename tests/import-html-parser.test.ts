import {expect,it,vi} from 'vitest';
import {createImportSource} from '../lib/imports/source';
import {parseHtmlSource} from '../lib/imports/html-parser';
import type {ImportSource} from '../lib/imports/types';

const source=(html:string,sourceUrl:string|null='https://yru.ac.th/guide')=>createImportSource({
 bytes:new TextEncoder().encode(html),filename:'guide.html',mimeType:'text/html',sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null,
});
it('retains nested paragraphs in address, blockquote and list blocks without hiding contact hours or warnings',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><h1>บริการ</h1><address><p>จ-ศ 08.00-17.00 น.</p><p>ส-อา 08.30-16.30 น.</p><p>(หยุดทุกวันหยุดนักขัตฤกษ์)</p></address><blockquote><p>คำเตือน</p></blockquote><ul><li><p>ขั้นตอนแรก</p><ul><li>ขั้นตอนย่อย</li></ul></li></ul></body></html>'));
 expect(result.pages.map(page=>page.text)).toEqual(['บริการ','จ-ศ 08.00-17.00 น.','ส-อา 08.30-16.30 น.','(หยุดทุกวันหยุดนักขัตฤกษ์)','คำเตือน','ขั้นตอนแรก','ขั้นตอนย่อย']);
 expect(result.locations.pages.map(location=>location.kind==='HTML'?location.blockStart:null)).toEqual([1,2,3,4,5,6,7]);
});

it('extracts decoded Thai title, headings and text with aligned stable locations and measured report',()=>{
 const input=source('<!doctype html><html><head><title>คู่มือ &amp; ระเบียบ</title></head><body><h1>ค่าธรรมเนียม &amp; ปฏิทิน</h1><p>สวัสดี <strong>นักศึกษา</strong></p></body></html>');
 const result=parseHtmlSource(input);
 expect(result.title).toBe('คู่มือ & ระเบียบ');
 expect(result.pages.map(page=>page.text)).toEqual(['ค่าธรรมเนียม & ปฏิทิน','สวัสดี นักศึกษา']);
 expect(result.pages.map(page=>page.pageNumber)).toEqual([null,null]);
 expect(result.pages[1].sectionTitle).toBe('ค่าธรรมเนียม & ปฏิทิน');
 expect(result.locations.pages).toEqual([
  {kind:'HTML',sourceUrl:input.sourceUrl,blockStart:1,blockEnd:1,headingPath:['ค่าธรรมเนียม & ปฏิทิน'],tableIndex:null},
  {kind:'HTML',sourceUrl:input.sourceUrl,blockStart:2,blockEnd:2,headingPath:['ค่าธรรมเนียม & ปฏิทิน'],tableIndex:null},
 ]);
 expect(result.report).toMatchObject({schemaVersion:1,parser:{name:'parse5',version:'8.0.1'},inputBytes:input.bytes.length,pages:2,tables:0,cells:0,truncated:false,warnings:[]});
 expect(result.report.textCharacters).toBe('ค่าธรรมเนียม & ปฏิทินสวัสดี นักศึกษา'.length);
 expect(result.report.replacementCharacters).toBe(0);
});

it('preserves exact decoded table cell strings, blank cells, heading provenance and table index',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><h1>ปฏิทิน</h1><table><thead><tr><th>กิจกรรม</th><th>วัน</th><th>หมายเหตุ</th></tr></thead><tbody><tr><td>ลงทะเบียน &amp; ยืนยัน</td><td>๑ สิงหาคม ๒๕๖๙</td><td></td></tr></tbody></table></body></html>'));
 expect(result.tables).toEqual([{pageNumber:null,sectionTitle:'ปฏิทิน',sheetName:null,firstRow:1,rows:[
  ['กิจกรรม','วัน','หมายเหตุ'],['ลงทะเบียน & ยืนยัน','๑ สิงหาคม ๒๕๖๙',''],
 ]}]);
 expect(result.locations.tables).toEqual([{kind:'HTML',sourceUrl:'https://yru.ac.th/guide',blockStart:2,blockEnd:2,headingPath:['ปฏิทิน'],tableIndex:1}]);
 expect(result.report).toMatchObject({pages:1,tables:1,cells:6,textCharacters:'ปฏิทินกิจกรรมวันหมายเหตุลงทะเบียน & ยืนยัน๑ สิงหาคม ๒๕๖๙'.length});
});

it('omits hidden and active subtrees, retains safe link labels, and never follows resource URLs',()=>{
 const fetchSpy=vi.spyOn(globalThis,'fetch');
 try{
  const result=parseHtmlSource(source('<!doctype html><html><head><meta http-equiv="refresh" content="0; url=https://redirect.invalid"></head><body><h1>คู่มือ</h1><p>เห็นได้</p><p hidden>HIDDEN_ATTRIBUTE_SECRET</p><div aria-hidden="true">ARIA_SECRET</div><div style="display:none !important">STYLE_SECRET</div><div class="d-none">CLASS_SECRET</div><script>INLINE_SECRET</script><style>.x{color:red}</style><template>TEMPLATE_SECRET</template><iframe src="https://external.invalid/frame">FRAME_SECRET</iframe><object data="https://external.invalid/object">OBJECT_SECRET</object><embed src="https://external.invalid/embed"><svg><text>SVG_SECRET</text></svg><math><mi>MATH_SECRET</mi></math><img src="https://external.invalid/image.png"><a href="https://external.invalid/path?private=secret">อ่านเพิ่มเติม</a></body></html>'));
  const output=JSON.stringify(result);
  expect(result.pages.map(page=>page.text)).toEqual(['คู่มือ','เห็นได้','อ่านเพิ่มเติม']);
  expect(result.flags).toContain('HIDDEN_DATA_REVIEW');expect(result.flags).toContain('EXTERNAL_LINKS_REVIEW');
  expect(result.report.warnings.every(warning=>warning.disposition==='UNRESOLVED')).toBe(true);
  expect(output).not.toContain('SECRET');expect(output).not.toContain('external.invalid');
  expect(fetchSpy).not.toHaveBeenCalled();
 }finally{fetchSpy.mockRestore();}
});

it('keeps nested tables separately and flags nested, merged and ragged table shapes',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><table><tr><td colspan="2">Outer<table><tr><td>Nested</td></tr></table></td><td>Right</td></tr><tr><td>Only one</td></tr></table></body></html>'));
 expect(result.tables).toHaveLength(2);
 expect(result.tables[0].rows).toEqual([['Outer','Right'],['Only one']]);
 expect(result.tables[1].rows).toEqual([['Nested']]);
 expect(result.locations.tables.map(location=>location.kind==='HTML'?location.tableIndex:null)).toEqual([1,2]);
 expect(result.flags).toContain('UNSUPPORTED_TABLES');expect(result.flags).toContain('TABLE_SHAPE_REVIEW');
 expect(result.report.warnings.every(warning=>warning.disposition==='UNRESOLVED')).toBe(true);
});
it('expands complete simple HTML header spans without shifting data or inventing amounts',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><h1>อัตราค่าธรรมเนียม</h1><table><thead><tr><th rowspan="2">หลักสูตร</th><th colspan="2">รหัส62–64</th><th colspan="2">รหัส65เป็นต้นไป</th></tr><tr><th>ปกติ</th><th>พิเศษ</th><th>ปกติ</th><th>พิเศษ</th></tr></thead><tbody><tr><td colspan="5">ครุศาสตรบัณฑิต</td></tr><tr><td>ภาษาอังกฤษ</td><td>14,500</td><td>15,500</td><td>11,000</td><td>12,000</td></tr><tr><td>ไม่มีอัตรา</td><td></td><td>10,000</td><td></td><td></td></tr></tbody></table></body></html>'));
 expect(result.tables[0].rows).toEqual([['หลักสูตร','รหัส62–64','','รหัส65เป็นต้นไป',''],['','ปกติ','พิเศษ','ปกติ','พิเศษ'],['ครุศาสตรบัณฑิต','','','',''],['ภาษาอังกฤษ','14,500','15,500','11,000','12,000'],['ไม่มีอัตรา','','10,000','','']]);
 expect(result.flags).not.toContain('UNSUPPORTED_TABLES');expect(result.flags).toContain('TABLE_SHAPE_REVIEW');expect(result.report.cells).toBe(25);
 expect(result.locations.tables[0]).toMatchObject({kind:'HTML',tableIndex:1,blockStart:2});
});
it('retains unsupported raw span geometry rather than filling gaps, crossing row groups or overlapping cells',()=>{
 for(const table of ['<thead><tr><th rowspan="2">x</th><th>y</th></tr></thead><tbody><tr><td>z</td></tr></tbody>','<tbody><tr><td>a</td><td rowspan="2">b</td></tr><tr><td colspan="2">c</td></tr></tbody>','<tr><td colspan="bad">a</td><td>b</td></tr>','<tr><td rowspan="0">a</td></tr>']){
  const result=parseHtmlSource(source('<!doctype html><html><body><table>'+table+'</table></body></html>'));expect(result.flags).toContain('UNSUPPORTED_TABLES');
 }
});
it('keeps trailing layout slots blank when a full-width section spans beyond the rate columns',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><table><tr><th>หลักสูตร</th><th colspan="2">รหัส65+</th></tr><tr><td colspan="5">สาขา</td></tr><tr><td>ภาษาอังกฤษ</td><td>11,000</td><td>12,000</td></tr></table></body></html>'));
 expect(result.tables[0].rows).toEqual([['หลักสูตร','รหัส65+','','',''],['สาขา','','','',''],['ภาษาอังกฤษ','11,000','12,000','','']]);
 expect(result.flags).toContain('TABLE_SHAPE_REVIEW');expect(result.flags).not.toContain('UNSUPPORTED_TABLES');expect(result.report.cells).toBe(15);
});
it('recovers duplicate attributes only inside skipped element start tags, retaining hidden-data review',()=>{
 const fetchSpy=vi.spyOn(globalThis,'fetch');try{
  const result=parseHtmlSource(source('<!doctype html><html><body><p>ประกาศ</p><img class="banner" src="https://external.invalid/a" class="responsive"><p>อ่านข้อมูล</p></body></html>'));
  expect(result.pages.map(p=>p.text)).toEqual(['ประกาศ','อ่านข้อมูล']);expect(result.flags).toContain('HIDDEN_DATA_REVIEW');expect(fetchSpy).not.toHaveBeenCalled();
  expect(()=>parseHtmlSource(source('<!doctype html><html><body><p class="a" class="b">data</p></body></html>'))).toThrow('IMPORT_PARSE_INVALID');
 }finally{fetchSpy.mockRestore();}
});

it('rejects parse errors with a fixed error and does not expose malformed source text',()=>{
 expect(()=>parseHtmlSource(source('<!doctype html><html><body><p><SECRET_TOKEN</body></html>'))).toThrowError(/^IMPORT_PARSE_INVALID$/u);
});

it('preserves a table caption as its section label and retains the heading path in location',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><body><h1>ค่าธรรมเนียม</h1><table><caption>ปีการศึกษา ๒๕๖๙</caption><tr><th>รายการ</th></tr><tr><td>๑,๒๐๐ บาท</td></tr></table></body></html>'));
 expect(result.tables[0].sectionTitle).toBe('ปีการศึกษา ๒๕๖๙');
 expect(result.locations.tables[0]).toMatchObject({kind:'HTML',headingPath:['ค่าธรรมเนียม'],tableIndex:1});
});

it('marks a blank table as low-text quality while retaining its exact row and provenance',()=>{
 const input=source('<!doctype html><html><head><title>ปฏิทิน</title></head><body><table><tr><td></td></tr></table></body></html>');
 const result=parseHtmlSource(input);
 expect(result.title).toBe('ปฏิทิน');
 expect(result.tables[0].rows).toEqual([['']]);
 expect(result.locations.tables[0]).toMatchObject({kind:'HTML',sourceUrl:input.sourceUrl,tableIndex:1});
 expect(result.flags).toContain('LOW_TEXT_QUALITY');
 expect(result.pages[0].requiresReview).toBe(true);
 expect(result.report.warnings).toContainEqual(expect.objectContaining({code:'LOW_TEXT_QUALITY',severity:'REVIEW',disposition:'UNRESOLVED'}));
});

it('marks a title-only document as low-text quality instead of treating its fallback title as content',()=>{
 const result=parseHtmlSource(source('<!doctype html><html><head><title>คู่มือทุน</title></head><body></body></html>'));
 expect(result.title).toBe('คู่มือทุน');
 expect(result.pages.map(page=>page.text)).toEqual(['คู่มือทุน']);
 expect(result.flags).toContain('LOW_TEXT_QUALITY');
 expect(result.pages[0].requiresReview).toBe(true);
 expect(result.report.warnings).toContainEqual(expect.objectContaining({code:'LOW_TEXT_QUALITY',severity:'REVIEW',disposition:'UNRESOLVED'}));
});

it('rejects excessive nesting, node count, extracted text, table count and cell size',()=>{
 const nested=`<!doctype html><html><body>${'<div>'.repeat(70)}too deep${'</div>'.repeat(70)}</body></html>`;
 const manyNodes=`<!doctype html><html><body>${'<br>'.repeat(50_100)}</body></html>`;
 const hiddenNodes=`<!doctype html><html><body><div hidden>${'<div>'.repeat(70)}hidden${'</div>'.repeat(70)}</div></body></html>`;
 const tooMuchText=`<!doctype html><html><body><p>${'x'.repeat(5_000_001)}</p></body></html>`;
 const manyTables=`<!doctype html><html><body>${'<table><tr><td>x</td></tr></table>'.repeat(1_001)}</body></html>`;
 const largeCell=`<!doctype html><html><body><table><tr><td>${'x'.repeat(10_001)}</td></tr></table></body></html>`;
 for(const html of [nested,manyNodes,hiddenNodes,tooMuchText,manyTables,largeCell])expect(()=>parseHtmlSource(source(html))).toThrow('IMPORT_PARSE_INVALID');
});

it('rejects non-HTML and tampered source bytes with the same fixed parser error',()=>{
 const csv=createImportSource({bytes:new TextEncoder().encode('a,b'),filename:'rows.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 expect(()=>parseHtmlSource(csv)).toThrow('IMPORT_PARSE_INVALID');
 const changed=source('<!doctype html><html><body>safe</body></html>');
 const tampered:ImportSource={...changed,bytes:Uint8Array.from(changed.bytes)};tampered.bytes[0]=0;
 expect(()=>parseHtmlSource(tampered)).toThrow('IMPORT_PARSE_INVALID');
});
