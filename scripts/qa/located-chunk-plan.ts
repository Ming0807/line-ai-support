import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createImportSource} from '../../lib/imports/source';
import {parseImportSource} from '../../lib/imports/parse-source';
import {buildLocatedChunkPlan} from '../../lib/knowledge/located-chunk-plan';
import {createLocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {officeEntries,officeSource,WORD_NS,SHEET_NS,REL_NS,PACKAGE_REL_NS} from '../../tests/fixtures/import-office';
import {createPdfFixture} from '../../tests/fixtures/import-pdf';

const input=(bytes:Uint8Array,filename:string)=>createImportSource({bytes,filename,mimeType:'',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
const enc=new TextEncoder(),thai='สวัสดี '.repeat(300);
const p=(text:string)=>`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx=officeSource('DOCX',officeEntries('DOCX',`<w:document xmlns:w="${WORD_NS}"><w:body>${p('ขั้นตอน')}${p(thai)}<w:tbl><w:tr><w:tc>${p('บริการ')}</w:tc><w:tc>${p('')}</w:tc></w:tr><w:tr><w:tc>${p('ห้องสมุด')}</w:tc><w:tc>${p('001.20')}</w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`));
const xlsx=officeSource('XLSX',officeEntries('XLSX',`<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="บริการ" sheetId="1" r:id="s1"/></sheets></workbook>`,[
 {name:'xl/_rels/workbook.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="s1" Type="${REL_NS}/worksheet" Target="worksheets/data.xml"/></Relationships>`},
 {name:'xl/worksheets/data.xml',data:`<worksheet xmlns="${SHEET_NS}"><sheetData><row r="3"><c r="B3" t="inlineStr"><is><t>ห้องสมุด</t></is></c><c r="D3"><v>001.20</v></c></row><row r="5"><c r="B5" t="inlineStr"><is><t>ทะเบียน</t></is></c></row></sheetData></worksheet>`},
]));
const sources=[input(createPdfFixture([{lines:[{text:'Reviewed synthetic service guide'}],tables:[[['Service','Fee'],['Library','001.20']]]}]),'fixture.pdf'),docx,xlsx,
 input(enc.encode('บริการ,ค่าใช้จ่าย,หมายเหตุ\r\nห้องสมุด,001.20,""\r\nทะเบียน,,วันเปิดทำการ\r\n'),'fixture.csv'),
 input(enc.encode(`<html><h1>ขั้นตอน</h1><p>${thai}</p><table><tr><td>บริการ</td><td></td></tr><tr><td>ห้องสมุด</td><td>001.20</td></tr></table></html>`),'fixture.html')];
const provider=createLocalE5EmbeddingProvider(),checks=[];
assert.equal((await provider.healthCheck()).healthy,true);
for(const source of sources){
 const extraction=await parseImportSource(source),started=performance.now(),binding={jobId:randomUUID(),extractionRevision:1};
 const plan=await buildLocatedChunkPlan(source,extraction,binding,provider);
 assert(plan.chunks.length>0);assert(plan.chunks.every(chunk=>chunk.sourceLocations.length>0&&chunk.sourceLocations.every(location=>location.kind===source.format)));
 for(const [index,page] of extraction.pages.entries()){
  if(!page.text)continue;
  const chunks=plan.chunks.filter(chunk=>chunk.coverage.kind==='PAGE'&&chunk.coverage.index===index);
  assert.equal(chunks.map(chunk=>chunk.content.slice(chunk.coverage.kind==='PAGE'?chunk.coverage.overlapPrefixLength:0)).join(''),page.text);
 }
 for(const [index,table] of extraction.tables.entries()){
  const chunks=plan.chunks.filter(chunk=>chunk.coverage.kind==='TABLE'&&chunk.coverage.index===index),rows=chunks.flatMap(chunk=>chunk.content.split('\n').map(line=>JSON.parse(line.slice(line.indexOf(': ')+2))));
  assert.deepEqual(rows,table.rows);
  for(const chunk of chunks){
   const location=chunk.sourceLocations[0],original=extraction.locations.tables[index],coverage=chunk.coverage;
   if((location.kind==='XLSX'||location.kind==='CSV')&&(original.kind==='XLSX'||original.kind==='CSV')&&coverage.kind==='TABLE'){
    assert.equal(location.rowStart,table.firstRow+coverage.rowStartIndex);assert.equal(location.rowEnd,table.firstRow+coverage.rowEndIndex);
    assert.equal(location.columnStart,original.columnStart);assert.equal(location.columnEnd,original.columnEnd);
   }
  }
 }
 let vectors=0;
 for(let index=0;index<plan.chunks.length;index+=16){
  const batch=plan.chunks.slice(index,index+16),remaining=Math.floor(45_000-(performance.now()-started));assert(remaining>0,'PREPARATION_DEADLINE');
  const counts=await provider.countPassageTokens(batch.map(chunk=>chunk.content),{timeoutMs:remaining});assert.deepEqual(counts,batch.map(chunk=>chunk.passageTokenCount));assert(counts.every(count=>count<=512));
  const timeLeft=Math.floor(45_000-(performance.now()-started));assert(timeLeft>0,'PREPARATION_DEADLINE');
  const embedded=await provider.embedPassages(batch.map(chunk=>chunk.content),{timeoutMs:timeLeft});assert(embedded.every(vector=>vector.length===384&&Math.abs(Math.hypot(...vector)-1)<0.001));vectors+=embedded.length;
 }
 checks.push({format:source.format,pages:extraction.pages.length,tables:extraction.tables.length,chunks:plan.chunks.length,maxPassageTokens:Math.max(...plan.chunks.map(chunk=>chunk.passageTokenCount)),vectors,normalized384:true,lossless:true,latencyMs:Math.round(performance.now()-started)});
}
console.log(JSON.stringify({status:'PASS',checks,generationCalled:false,sqlCalled:false,publicationCalled:false}));
