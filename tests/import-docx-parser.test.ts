import {expect,it} from 'vitest';
import {parseDocxSource} from '../lib/imports/docx-parser';
import {officeEntries,officeSource,PACKAGE_REL_NS,REL_NS,WORD_NS} from './fixtures/import-office';

const STRICT_WORD_NS='http://purl.oclc.org/ooxml/wordprocessingml/main';
const STRICT_REL_NS='http://purl.oclc.org/ooxml/officeDocument/relationships';
const document=(body:string,namespace=WORD_NS)=>`<w:document xmlns:w="${namespace}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const paragraph=(text:string)=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const makeSource=(body:string,extra:{name:string;data:string}[]=[],namespace=WORD_NS)=>officeSource('DOCX',officeEntries('DOCX',document(body,namespace),extra));

it('keeps body block order, heading paths, exact tabs/breaks, table cells, and nullable DOCX pages',async()=>{
 const body=`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>ขั้นตอน</w:t></w:r></w:p>
 <w:p><w:r><w:t>ไปที่</w:t><w:tab/><w:t>ทะเบียน</w:t><w:br/><w:t>ต่อ</w:t></w:r></w:p>
 <w:tbl><w:tr><w:tc>${paragraph('หัวข้อ')}</w:tc><w:tc>${paragraph('วัน\tเวลา')}</w:tc></w:tr><w:tr><w:tc>${paragraph('ลงทะเบียน')}</w:tc><w:tc>${paragraph('10 มิ.ย.')}</w:tc></w:tr></w:tbl>
 ${paragraph('เสร็จสิ้น')}`;
 const result=await parseDocxSource(makeSource(body));
 expect(result.pages.map(page=>page.text)).toEqual(['ขั้นตอน','ไปที่\tทะเบียน\nต่อ','','เสร็จสิ้น']);
 expect(result.pages.every(page=>page.pageNumber===null)).toBe(true);
 expect(result.pages.map(page=>page.sectionTitle)).toEqual(['ขั้นตอน','ขั้นตอน','ขั้นตอน','ขั้นตอน']);
 expect(result.tables).toEqual([{pageNumber:null,sectionTitle:'ขั้นตอน',sheetName:null,firstRow:1,rows:[['หัวข้อ','วัน\tเวลา'],['ลงทะเบียน','10 มิ.ย.']]}]);
 expect(result.locations.pages).toEqual([
  {kind:'DOCX',blockStart:1,blockEnd:1,headingPath:['ขั้นตอน'],tableIndex:null},
  {kind:'DOCX',blockStart:2,blockEnd:2,headingPath:['ขั้นตอน'],tableIndex:null},
  {kind:'DOCX',blockStart:3,blockEnd:3,headingPath:['ขั้นตอน'],tableIndex:1},
  {kind:'DOCX',blockStart:4,blockEnd:4,headingPath:['ขั้นตอน'],tableIndex:null},
 ]);
 expect(result.locations.tables).toEqual([{kind:'DOCX',blockStart:3,blockEnd:3,headingPath:['ขั้นตอน'],tableIndex:1}]);
 expect(result.report).toMatchObject({schemaVersion:1,parser:{name:'yru-docx'},inputBytes:expect.any(Number),pages:4,tables:1,cells:4,truncated:false,warnings:[]});
});

it.each([
 ['body',`ข้อความตรงใน body${paragraph('safe')}`],
 ['paragraph','<w:p>ข้อความตรงนอก run<w:r><w:t>ข้อความ</w:t></w:r></w:p>'],
 ['run','<w:p><w:r>ข้อความตรงนอก w:t<w:t>ข้อความ</w:t></w:r></w:p>'],
 ['text element','<w:p><w:r><w:t>ข้อความ<w:tab/></w:t></w:r></w:p>'],
])('rejects non-whitespace structural text in a %s instead of dropping it',async(_name,body)=>{
 await expect(parseDocxSource(makeSource(body))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});

it('recognizes Strict WordprocessingML and relationship namespaces without inventing page numbers',async()=>{
 const entries=officeEntries('DOCX',document(paragraph('ข้อความไทย'),STRICT_WORD_NS));
 entries[1].data=String(entries[1].data).replace(REL_NS,STRICT_REL_NS);
 const result=await parseDocxSource(officeSource('DOCX',entries));
 expect(result.pages).toMatchObject([{pageNumber:null,text:'ข้อความไทย'}]);
 expect(result.locations.pages[0]).toMatchObject({kind:'DOCX',blockStart:1,blockEnd:1});
});

it('uses outline levels from related styles and flags text hidden by a character style',async()=>{
 const styles=`<w:styles xmlns:w="${WORD_NS}"><w:style w:type="paragraph" w:styleId="SectionTitle"><w:name w:val="หัวข้อ"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`;
 const rels=`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="styles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
 const body=`<w:p><w:pPr><w:pStyle w:val="SectionTitle"/></w:pPr><w:r><w:t>หลักเกณฑ์</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:rStyle w:val="Hidden"/></w:rPr><w:t>ข้อมูลซ่อนจากสไตล์</w:t></w:r><w:r><w:t>ข้อมูลที่เห็น</w:t></w:r></w:p>`;
 const source=makeSource(body,[{name:'word/styles.xml',data:styles},{name:'word/_rels/document.xml.rels',data:rels}]);
 const result=await parseDocxSource(source);
 expect(result.pages.map(page=>page.text)).toEqual(['หลักเกณฑ์','ข้อมูลที่เห็น']);
 expect(result.locations.pages[1]).toMatchObject({headingPath:['หลักเกณฑ์']});
 expect(result.flags).toContain('HIDDEN_DATA_REVIEW');
});

it('withholds runs hidden by document defaults and records a blocking review warning',async()=>{
 const styles=`<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
 const rels=`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="styles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
 const result=await parseDocxSource(makeSource(paragraph('ซ่อนโดยค่าปริยาย'),[
  {name:'word/styles.xml',data:styles},{name:'word/_rels/document.xml.rels',data:rels},
 ]));
 expect(result.pages.map(page=>page.text)).toEqual(['']);
 expect(result.flags).toContain('HIDDEN_DATA_REVIEW');
 expect(result.report.warnings.find(warning=>warning.code==='HIDDEN_DATA_REVIEW')).toMatchObject({severity:'BLOCKING',disposition:'UNRESOLVED'});
});

it('records extracted replacement characters as unresolved low-text-quality evidence',async()=>{
 const result=await parseDocxSource(makeSource(paragraph('เสีย�')));
 expect(result.report.replacementCharacters).toBe(1);
 expect(result.flags).toContain('LOW_TEXT_QUALITY');
 expect(result.report.warnings.find(warning=>warning.code==='LOW_TEXT_QUALITY')).toMatchObject({severity:'REVIEW',count:1,disposition:'UNRESOLVED'});
});

it('rejects a wrong-root or duplicate-ID styles part instead of silently ignoring style semantics',async()=>{
 const rels=`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="styles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
 const styles=[
  `<w:other xmlns:w="${WORD_NS}"/>`,
  `<w:styles xmlns:w="${WORD_NS}"><w:style w:type="paragraph" w:styleId="Same"/><w:style w:type="paragraph" w:styleId="Same"/></w:styles>`,
 ];
 for(const value of styles){
  const source=makeSource('<w:p><w:pPr><w:pStyle w:val="Same"/></w:pPr><w:r><w:t>ข้อความ</w:t></w:r></w:p>',[
   {name:'word/styles.xml',data:value},{name:'word/_rels/document.xml.rels',data:rels},
  ]);
  await expect(parseDocxSource(source)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 }
});

it('surfaces revisions, hidden text, fields, media, and external links as review warnings without executing or fetching them',async()=>{
 const body=`${paragraph('คงไว้')}
 <w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>ซ่อน</w:t></w:r><w:ins><w:r><w:t>เพิ่มระหว่างแก้</w:t></w:r></w:ins><w:del><w:r><w:delText>ข้อความลบ</w:delText></w:r></w:del></w:p>
 <w:p><w:fldSimple w:instr="HYPERLINK &quot;https://outside.invalid/private&quot;"><w:r><w:t>cached field value</w:t></w:r></w:fldSimple></w:p>
 <w:p><w:r><w:t>มีภาพ</w:t><w:drawing><w:inline><w:graphic><w:graphicData/></w:graphic></w:inline></w:drawing></w:r></w:p>`;
 const rels=`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="external" Type="${REL_NS}/hyperlink" TargetMode="External" Target="https://outside.invalid/private"/></Relationships>`;
 const result=await parseDocxSource(makeSource(body,[{name:'word/_rels/document.xml.rels',data:rels}]));
 const extracted=JSON.stringify(result.pages.map(page=>page.text));
 expect(extracted).toContain('คงไว้');expect(extracted).not.toContain('ซ่อน');expect(extracted).not.toContain('เพิ่มระหว่างแก้');
 expect(extracted).not.toContain('ข้อความลบ');expect(extracted).not.toContain('cached field value');expect(extracted).not.toContain('outside.invalid');
 expect(result.flags).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','OCR_REQUIRED','EXTERNAL_LINKS_REVIEW']));
 expect(result.report.warnings.map(warning=>warning.code)).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','OCR_REQUIRED','EXTERNAL_LINKS_REVIEW']));
 expect(JSON.stringify(result)).not.toContain('outside.invalid');
});

it('preserves physical merged cells but marks merged and nested table semantics for review',async()=>{
 const body=`<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${paragraph('รวมสองช่อง')}</w:tc><w:tc>${paragraph('ขวา')}</w:tc></w:tr>
  <w:tr><w:tc>${paragraph('หลัก')}<w:tbl><w:tr><w:tc>${paragraph('ตารางซ้อน')}</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>`;
 const result=await parseDocxSource(makeSource(body));
 expect(result.tables[0].rows).toEqual([['รวมสองช่อง','ขวา'],['หลัก']]);
 expect(result.flags).toEqual(expect.arrayContaining(['TABLE_SHAPE_REVIEW','UNSUPPORTED_TABLES']));
 expect(result.report.warnings.map(warning=>warning.code)).toEqual(expect.arrayContaining(['TABLE_SHAPE_REVIEW','UNSUPPORTED_TABLES']));
});

it('does not silently flatten unsupported table wrappers or move-revision ranges',async()=>{
 const body=`<w:p><w:r><w:t>ก่อน</w:t></w:r><w:moveFromRangeStart w:id="1"/><w:r><w:t>ย้ายออก</w:t></w:r><w:moveFromRangeEnd w:id="1"/></w:p>
  <w:tbl><w:sdt><w:sdtContent><w:tr><w:tc>${paragraph('ตารางที่ห่อ')}</w:tc></w:tr></w:sdtContent></w:sdt></w:tbl>`;
 const result=await parseDocxSource(makeSource(body));
 expect(result.pages[0].text).toBe('');expect(result.tables[0].rows).toEqual([['']]);
 expect(result.flags).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','TABLE_SHAPE_REVIEW','UNSUPPORTED_TABLES']));
});

it('warns on foreign namespace body bookmarks and foreign table, row, and cell children',async()=>{
 const body=`<x:bookmarkStart xmlns:x="urn:foreign"/><w:p><w:r><w:t>body text</w:t></w:r></w:p>
  <w:tbl><x:tableExtension xmlns:x="urn:foreign"/><w:tr><x:rowExtension xmlns:x="urn:foreign"/><w:tc><x:cellExtension xmlns:x="urn:foreign">hidden table content</x:cellExtension><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
 const result=await parseDocxSource(makeSource(body));
 expect(result.pages.map(page=>page.text)).toEqual(['body text','']);
 expect(result.tables[0].rows).toEqual([['cell']]);
 expect(result.flags).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','UNSUPPORTED_TABLES']));
 expect(result.report.warnings).toEqual(expect.arrayContaining([
  expect.objectContaining({code:'HIDDEN_DATA_REVIEW',severity:'BLOCKING'}),
  expect.objectContaining({code:'UNSUPPORTED_TABLES',severity:'BLOCKING'}),
 ]));
});

it('warns when text in a related header story is outside the main-body extraction',async()=>{
 const header=`<w:hdr xmlns:w="${WORD_NS}">${paragraph('ข้อความหัวกระดาษ')}</w:hdr>`;
 const rels=`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="header" Type="${REL_NS}/header" Target="header1.xml"/></Relationships>`;
 const result=await parseDocxSource(makeSource(paragraph('เนื้อหา'),[{name:'word/header1.xml',data:header},{name:'word/_rels/document.xml.rels',data:rels}]));
 expect(result.pages.map(page=>page.text)).toEqual(['เนื้อหา']);
 expect(result.flags).toContain('HIDDEN_DATA_REVIEW');
 expect(result.report.warnings.find(warning=>warning.code==='HIDDEN_DATA_REVIEW')).toMatchObject({severity:'BLOCKING',location:null});
});

it('keeps a fully hidden document visibly low quality and unresolved',async()=>{
 const result=await parseDocxSource(makeSource('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden only</w:t></w:r></w:p>'));
 expect(result.pages).toMatchObject([{pageNumber:null,text:'',requiresReview:true}]);
 expect(result.flags).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','LOW_TEXT_QUALITY']));
});

it('preserves explicit line breaks while flagging rendered page hints without assigning page numbers',async()=>{
 const body='<w:p><w:r><w:t>หน้าแรก</w:t><w:br w:type="page"/><w:t>หน้าถัดไป</w:t><w:lastRenderedPageBreak/><w:t> ต่อ</w:t></w:r></w:p>';
 const result=await parseDocxSource(makeSource(body));
 expect(result.pages[0]).toMatchObject({pageNumber:null,text:'หน้าแรก\nหน้าถัดไป ต่อ'});
 expect(result.flags).toContain('PAGE_REVIEW_REQUIRED');
});

it('rejects malformed, wrong-format, and output-overflow input with one fixed parser error',async()=>{
 const malformed=makeSource('<w:p><w:r><w:t>broken</w:r></w:p>');
 await expect(parseDocxSource(malformed)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 await expect(parseDocxSource(officeSource('XLSX',officeEntries('XLSX','<x/>')))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 const tooManyBlocks=makeSource(Array.from({length:1001},(_,index)=>paragraph(String(index))).join(''));
 await expect(parseDocxSource(tooManyBlocks)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 const oversizedCell=`<w:tbl><w:tr><w:tc>${paragraph('x'.repeat(10_001))}</w:tc></w:tr></w:tbl>`;
 await expect(parseDocxSource(makeSource(oversizedCell))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 const tooManyColumns=`<w:tbl><w:tr>${Array.from({length:257},()=>`<w:tc>${paragraph('x')}</w:tc>`).join('')}</w:tr></w:tbl>`;
 await expect(parseDocxSource(makeSource(tooManyColumns))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
