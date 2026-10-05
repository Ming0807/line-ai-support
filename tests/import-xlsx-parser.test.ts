import {expect,it} from 'vitest';
import {parseXlsxSource} from '../lib/imports/xlsx-parser';
import {PACKAGE_REL_NS,REL_NS,SHEET_NS,officeEntries,officeSource} from './fixtures/import-office';
import type {ImportZipEntryFixture} from './fixtures/import-zip';
const workbook=(sheets='<sheet name="ค่าใช้จ่าย" sheetId="1" r:id="s1"/>',namespace=SHEET_NS,relNamespace=REL_NS)=>`<workbook xmlns="${namespace}" xmlns:r="${relNamespace}"><sheets>${sheets}</sheets></workbook>`;
const worksheet=(data:string,extra='',namespace=SHEET_NS)=>`<worksheet xmlns="${namespace}">${extra}<sheetData>${data}</sheetData></worksheet>`;
function source(xml:string,extra:ImportZipEntryFixture[]=[],book=workbook()){
 return officeSource('XLSX',officeEntries('XLSX',book,[{name:'xl/_rels/workbook.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="s1" Type="${REL_NS}/worksheet" Target="worksheets/data.xml"/>${extra.some(entry=>entry.name==='xl/sharedStrings.xml')?`<Relationship Id="strings" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`:''}${extra.some(entry=>entry.name==='xl/styles.xml')?`<Relationship Id="styles" Type="${REL_NS}/styles" Target="styles.xml"/>`:''}</Relationships>`},{name:'xl/worksheets/data.xml',data:xml},...extra]));
}
it('preserves Thai rich/shared/inline strings, exact stored numerics, blanks and sparse coordinates',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="3"><c r="B3" t="s"><v>0</v></c><c r="D3"><v>001.2300</v></c></row><row r="5"><c r="B5" t="inlineStr"><is><t xml:space="preserve">  บาท </t></is></c><c r="D5" t="b"><v>1</v></c></row>'),[{name:'xl/sharedStrings.xml',data:`<sst xmlns="${SHEET_NS}"><si><r><t>ค่า</t></r><r><t>เทอม &amp; </t></r><t>ยืนยัน</t></si></sst>`}]));
 expect(value.tables[0].rows).toEqual([['ค่าเทอม & ยืนยัน','','001.2300'],['','',''],['  บาท ','','1']]);
 expect(value.locations.tables[0]).toEqual({kind:'XLSX',sheetName:'ค่าใช้จ่าย',sheetIndex:1,rowStart:3,rowEnd:5,columnStart:2,columnEnd:4,tableIndex:1});
 expect(value.pages[0]).toMatchObject({pageNumber:null,text:'',sectionTitle:'ค่าใช้จ่าย',requiresReview:false});
 expect(value.report).toMatchObject({parser:{name:'yru-xlsx',version:'1'},pages:1,tables:1,cells:9,truncated:false});expect(value.flags).toEqual([]);
});
it('never computes a formula or converts styled numeric caches to dates/currency',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="1"><c r="A1" s="0"><f>HYPERLINK("https://private.invalid","run")</f><v>45292.00</v></c><c r="B1" t="str"><f>1+1</f><v>001</v></c></row>'),[{name:'xl/styles.xml',data:`<styleSheet xmlns="${SHEET_NS}"><cellXfs count="1"><xf numFmtId="14"/></cellXfs></styleSheet>`}]));
 expect(value.tables[0].rows).toEqual([['45292.00','001']]);expect(value.flags).toEqual(expect.arrayContaining(['FORMULAS_PRESENT','TABLE_SHAPE_REVIEW']));
 expect(value.report.warnings.filter(warning=>warning.code==='FORMULAS_PRESENT')).toEqual([expect.objectContaining({severity:'BLOCKING',disposition:'UNRESOLVED',count:2})]);
 expect(value.pages[0].requiresReview).toBe(true);
});
it('retains hidden rows/columns/sheet data privately with blocking review evidence',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="2" hidden="1"><c r="A2" t="inlineStr"><is><t>ข้อมูลซ่อน</t></is></c></row>','<cols><col min="1" max="1" hidden="1"/></cols>'),[],workbook('<sheet name="ลับ" sheetId="1" state="veryHidden" r:id="s1"/>')));
 expect(value.tables[0].rows).toEqual([['ข้อมูลซ่อน']]);expect(value.flags).toContain('HIDDEN_DATA_REVIEW');
 expect(value.report.warnings).toEqual(expect.arrayContaining([expect.objectContaining({code:'HIDDEN_DATA_REVIEW',severity:'BLOCKING'})]));
});
it('flags merged, external and unsupported worksheet features instead of clean extraction',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="1"><c r="A1" t="inlineStr"><is><t>ค่าใช้จ่าย</t></is></c></row>','<mergeCells><mergeCell ref="A1:B1"/></mergeCells><drawing xmlns:r="'+REL_NS+'" r:id="d"/>'),[
  {name:'xl/worksheets/_rels/data.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="d" Type="${REL_NS}/drawing" TargetMode="External" Target="https://external.invalid/private"/></Relationships>`},
 ]));
 expect(value.flags).toEqual(expect.arrayContaining(['UNSUPPORTED_TABLES','EXTERNAL_LINKS_REVIEW','PAGE_REVIEW_REQUIRED']));
 expect(value.report.warnings.find(warning=>warning.code==='UNSUPPORTED_TABLES')?.severity).toBe('BLOCKING');
});
it('uses workbook relationship order and distinct worksheet locations',async()=>{
 const book=workbook('<sheet name="สอง" sheetId="5" r:id="second"/><sheet name="หนึ่ง" sheetId="1" r:id="first"/>');
 const value=await parseXlsxSource(officeSource('XLSX',officeEntries('XLSX',book,[
  {name:'xl/_rels/workbook.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="first" Type="${REL_NS}/worksheet" Target="worksheets/a.xml"/><Relationship Id="second" Type="${REL_NS}/worksheet" Target="worksheets/b.xml"/></Relationships>`},
  {name:'xl/worksheets/a.xml',data:worksheet('<row r="7"><c r="C7" t="inlineStr"><is><t>ก</t></is></c></row>')},
  {name:'xl/worksheets/b.xml',data:worksheet('<row r="9"><c r="D9" t="inlineStr"><is><t>ข</t></is></c></row>')},
 ])));
 expect(value.tables.map(table=>table.rows)).toEqual([[['ข']],[['ก']]]);expect(value.locations.tables).toEqual([
  expect.objectContaining({sheetName:'สอง',sheetIndex:1,rowStart:9,columnStart:4,tableIndex:1}),
  expect.objectContaining({sheetName:'หนึ่ง',sheetIndex:2,rowStart:7,columnStart:3,tableIndex:2}),
 ]);
});
it.each([
 '<row r="1"><c r="A1" t="s"><v>99</v></c></row>',
 '<row r="1"><c r="A1"/><c r="A1"/></row>',
 '<row r="1"><c r="A2"/></row>',
 '<row r="0"><c r="A0"/></row>',
 '<row r="1"><c r="XFE1"/></row>',
 '<row r="1"><c r="A1" t="n"><v>not a number</v></c></row>',
 '<row r="1"><c r="A1" t="b"><v>true</v></c></row>',
 '<row r="1"><c r="A1" t="inlineStr"><v>wrong</v></c></row>',
 '<row r="1"><c r="A1" s="99"><v>1</v></c></row>',
 '<row r="1"><c r="A1"><v>1</v><v>2</v></c></row>',
 '<row r="2"/><row r="1"/>',
 '<row r="1"><c r="B1"/><c r="A1"/></row>',
])('rejects malformed cells/coordinates with fixed errors %#',async data=>{await expect(parseXlsxSource(source(worksheet(data)))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);});
it.each([
 '<row r="1"><c r="A1"/><c r="IW1"/></row>',
 '<row r="1"><c r="A1"/></row><row r="10001"><c r="A10001"/></row>',
 '<row r="1"><c r="A1"/></row><row r="10000"><c r="K10000"/></row>',
 `<row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(10001)}</t></is></c></row>`,
])('bounds sparse expansion and exact cell lengths %#',async data=>{await expect(parseXlsxSource(source(worksheet(data)))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);});
it('keeps empty worksheets as review-required, without inferring clean quality from sheet title',async()=>{
 const value=await parseXlsxSource(source(worksheet('')));expect(value.tables).toEqual([]);expect(value.pages[0]).toMatchObject({text:'',requiresReview:true,pageNumber:null});expect(value.flags).toContain('LOW_TEXT_QUALITY');
});
it('rejects missing/duplicate/foreign worksheet bindings and malformed workbook identities',async()=>{
 for(const sheets of ['<sheet name="A" sheetId="1" r:id="missing"/>','<sheet name="A" sheetId="1" r:id="s1"/><sheet name="a" sheetId="2" r:id="s1"/>','<sheet name="A" sheetId="0" r:id="s1"/>'])
  await expect(parseXlsxSource(source(worksheet(''),[],workbook(sheets)))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 await expect(parseXlsxSource(source(worksheet('', '', 'urn:spoof')))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('supports Strict namespaces without matching only local element names',async()=>{
 const strict='http://purl.oclc.org/ooxml/spreadsheetml/main',strictRel='http://purl.oclc.org/ooxml/officeDocument/relationships';
 const value=await parseXlsxSource(source(worksheet('<row r="1"><c r="A1"><v>001</v></c></row>','',strict),[],workbook(undefined,strict,strictRel)));
 expect(value.tables[0].rows).toEqual([['001']]);
});
it('flags replacement characters and cell errors as low quality',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="1"><c r="A1" t="inlineStr"><is><t>เสีย�</t></is></c><c r="B1" t="e"><v>#REF!</v></c></row>')));
 expect(value.report.replacementCharacters).toBe(1);expect(value.flags).toContain('LOW_TEXT_QUALITY');
});
it('flags inherited row formatting, default-hidden rows and unknown workbook protection properties for review',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="1" s="1" customFormat="1"><c r="A1"><v>45292</v></c></row>','<sheetFormatPr zeroHeight="1"/>'),[
  {name:'xl/styles.xml',data:`<styleSheet xmlns="${SHEET_NS}"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`},
 ]));
 expect(value.tables[0].rows).toEqual([['45292']]);expect(value.flags).toEqual(expect.arrayContaining(['HIDDEN_DATA_REVIEW','TABLE_SHAPE_REVIEW']));
});
it.each(['<is>DROP<t>KEEP</t>DROP</is>','<is><r>DROP<t>KEEP</t></r></is>'])('rejects unsupported direct text in inline rich-string containers %#',async content=>{
 await expect(parseXlsxSource(source(worksheet(`<row r="1"><c r="A1" t="inlineStr">${content}</c></row>`)))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('rejects unsupported direct text in shared strings and structural containers',async()=>{
 await expect(parseXlsxSource(source(worksheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'),[{name:'xl/sharedStrings.xml',data:`<sst xmlns="${SHEET_NS}"><si>DROP<t>KEEP</t></si></sst>`}]))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 await expect(parseXlsxSource(source(worksheet('<row r="1">DROP<c r="A1"><v>1</v></c></row>')))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('flags number-format inheritance from cellStyleXfs when applyNumberFormat is false',async()=>{
 const value=await parseXlsxSource(source(worksheet('<row r="1"><c r="A1" s="0"><v>45292</v></c></row>'),[
  {name:'xl/styles.xml',data:`<styleSheet xmlns="${SHEET_NS}"><cellStyleXfs><xf numFmtId="14"/></cellStyleXfs><cellXfs><xf xfId="0" numFmtId="0" applyNumberFormat="0"/></cellXfs></styleSheet>`},
 ]));expect(value.tables[0].rows).toEqual([['45292']]);expect(value.flags).toContain('TABLE_SHAPE_REVIEW');
});
