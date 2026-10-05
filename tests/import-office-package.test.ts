import {expect,it} from 'vitest';
import {readOfficePackage} from '../lib/imports/office-package';
import {PACKAGE_REL_NS,REL_NS,WORD_NS,officeEntries,officeSource} from './fixtures/import-office';
const document=`<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>สวัสดี</w:t></w:r></w:p></w:body></w:document>`;
const entries=()=>officeEntries('DOCX',document);
it('selects actual main part through content type and root relationship, not a guessed filename',async()=>{
 const source=officeSource('DOCX',officeEntries('DOCX',document,[], 'custom/main.xml'));
 const value=await readOfficePackage(source);expect(value.mainPath).toBe('custom/main.xml');expect(value.main.local).toBe('document');
 expect(value.parts.get('custom/main.xml')).toBe(value.main);expect(value.hasExternalLinks).toBe(false);
 expect(value.relationships('')).toEqual([{id:'root',type:`${REL_NS}/officeDocument`,target:'custom/main.xml',external:false}]);
});
it('resolves safe parent-relative internal targets and records external relationships without exposing URLs',async()=>{
 const source=officeSource('DOCX',officeEntries('DOCX',document,[{name:'word/_rels/document.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="s" Type="${REL_NS}/styles" Target="../shared/styles.xml"/><Relationship Id="h" Type="${REL_NS}/hyperlink" TargetMode="External" Target="https://external.invalid/private"/></Relationships>`},{name:'shared/styles.xml',data:`<w:styles xmlns:w="${WORD_NS}"/>`}]));
 const value=await readOfficePackage(source);expect(value.relationships(value.mainPath)).toEqual([
  {id:'s',type:`${REL_NS}/styles`,target:'shared/styles.xml',external:false},
  {id:'h',type:`${REL_NS}/hyperlink`,target:null,external:true},
 ]);expect(value.hasExternalLinks).toBe(true);expect(JSON.stringify(value.relationships(value.mainPath))).not.toContain('external.invalid');
});
it.each([
 ['missing root',()=>entries().filter(entry=>entry.name!=='_rels/.rels')],
 ['wrong format',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:String(entry.data).replace('wordprocessingml.document','spreadsheetml.sheet')}:entry)],
 ['untyped part',()=>[...entries(),{name:'untyped.xyz',data:'x'}]],
 ['dangling override',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:String(entry.data).replace('</Types>','<Override PartName="/missing.xml" ContentType="application/xml"/></Types>')}:entry)],
 ['duplicate default',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:String(entry.data).replace('</Types>','<Default Extension="XML" ContentType="application/xml"/></Types>')}:entry)],
 ['duplicate main relation',()=>entries().map(entry=>entry.name==='_rels/.rels'?{...entry,data:String(entry.data).replace('</Relationships>',`<Relationship Id="another" Type="${REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>`)}:entry)],
 ['macro content type',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:String(entry.data).replace('wordprocessingml.document.main','wordprocessingml.document.macroEnabled.main')}:entry)],
 ['active auxiliary XML',()=>[...entries(),{name:'custom/extra.xml',data:'<!DOCTYPE a SYSTEM "https://external.invalid"><a/>'}]],
 ['wrong content root',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:`<Types xmlns="urn:spoof"/>`}:entry)],
 ['external main',()=>entries().map(entry=>entry.name==='_rels/.rels'?{...entry,data:String(entry.data).replace('Target="word/document.xml"','TargetMode="External" Target="https://external.invalid"')}:entry)],
 ['duplicate override',()=>entries().map(entry=>entry.name==='[Content_Types].xml'?{...entry,data:String(entry.data).replace('</Types>',`<Override PartName="/word/document.xml" ContentType="application/xml"/></Types>`)}:entry)],
])('rejects invalid package %s',async(_name,build)=>{await expect(readOfficePackage(officeSource('DOCX',build()))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);});
it.each(['../../escape.xml','https://external.invalid/x.xml','styles.xml?key=private','%2e%2e/escape.xml','styles.xml#anchor','missing.xml'])('rejects unsafe or dangling internal target %s',async target=>{
 const source=officeSource('DOCX',officeEntries('DOCX',document,[{name:'word/_rels/document.xml.rels',data:`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="r" Type="${REL_NS}/styles" Target="${target}"/></Relationships>`}]));
 await expect(readOfficePackage(source)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('rejects invalid relationship IDs, modes and orphaned relationship owners',async()=>{
 for(const data of [`<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="r" Type="${REL_NS}/styles" Target="../word/document.xml" TargetMode="Unknown"/></Relationships>`,
  `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="r" Type="${REL_NS}/styles" Target="document.xml"/><Relationship Id="r" Type="${REL_NS}/styles" Target="document.xml"/></Relationships>`]){
  await expect(readOfficePackage(officeSource('DOCX',officeEntries('DOCX',document,[{name:'word/_rels/missing.xml.rels',data}])))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 }
});
it('refuses non-Office input and already aborted work',async()=>{
 const signal=AbortSignal.abort();await expect(readOfficePackage(officeSource('DOCX',entries()),signal)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
 const wrong=officeSource('XLSX',entries());await expect(readOfficePackage(wrong)).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('rejects disguised non-XML active content even when called passive package data',async()=>{
 const value=entries();value[0].data=String(value[0].data).replace('</Types>',`<Default Extension="dat" ContentType="application/octet-stream"/></Types>`);
 value.push({name:'word/payload.dat',data:'passive-looking'});await expect(readOfficePackage(officeSource('DOCX',value))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('accepts strict Office main relationship and strict main XML namespace',async()=>{
 const value=entries();value[1].data=String(value[1].data).replace(REL_NS,'http://purl.oclc.org/ooxml/officeDocument/relationships');
 value[2].data=document.replace(WORD_NS,'http://purl.oclc.org/ooxml/wordprocessingml/main');
 expect((await readOfficePackage(officeSource('DOCX',value))).main.uri).toBe('http://purl.oclc.org/ooxml/wordprocessingml/main');
});
it('requires actual XML for every declared XML part irrespective of filename extension',async()=>{
 const value=entries();value[0].data=String(value[0].data).replace('</Types>',`<Override PartName="/extra.dat" ContentType="application/xml"/></Types>`);
 value.push({name:'extra.dat',data:'not XML'});await expect(readOfficePackage(officeSource('DOCX',value))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('requires the standard relationship media type',async()=>{
 const wrongType=entries();wrongType[0].data=String(wrongType[0].data).replace('application/vnd.openxmlformats-package.relationships+xml','application/xml');
 await expect(readOfficePackage(officeSource('DOCX',wrongType))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
it('rejects active relationship types even to inert XML',async()=>{
 const active=officeEntries('DOCX',document,[{name:'word/embedded.xml',data:'<x/>'}]);
 active[1].data=String(active[1].data).replace('</Relationships>',`<Relationship Id="ole" Type="${REL_NS}/oleObject" Target="word/embedded.xml"/></Relationships>`);
 await expect(readOfficePackage(officeSource('DOCX',active))).rejects.toThrow(/^IMPORT_PARSE_INVALID$/);
});
