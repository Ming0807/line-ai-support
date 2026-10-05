import {expect,it} from 'vitest';
import {deflateRawSync} from 'node:zlib';
import {readSafeOfficeArchive} from '../lib/imports/safe-archive';
import {createImportZipFixture,crc32ForImportZip,type ImportZipEntryFixture,type ImportZipFixtureOptions} from './fixtures/import-zip';

const limitEntry=16*1024*1024;
const archive=(entries:ImportZipEntryFixture[])=>createImportZipFixture(entries);

it('reads a real in-memory ZIP lazily and returns only bounded package files',async()=>{
 const result=await readSafeOfficeArchive(archive([
  {name:'[Content_Types].xml',data:'<Types/>',method:0},
  {name:'word/document.xml',data:'<w:document>เรื่อง</w:document>'},
  {name:'word/',data:'',method:0,externalFileAttributes:0x10},
 ]));
 expect([...result.keys()]).toEqual(['[Content_Types].xml','word/document.xml']);
 expect(new TextDecoder().decode(result.get('word/document.xml'))).toBe('<w:document>เรื่อง</w:document>');
});

const unsafeArchiveCases:Array<{label:string;entries:ImportZipEntryFixture[];options?:ImportZipFixtureOptions}>=[
 {label:'duplicate part names',entries:[{name:'word/document.xml',data:'first'},{name:'word/document.xml',data:'second'}]},
 {label:'case-colliding part names',entries:[{name:'Word/document.xml',data:'first'},{name:'word/document.xml',data:'second'}]},
 {label:'path traversal',entries:[{name:'../document.xml',data:'bad'}]},
 {label:'an absolute path',entries:[{name:'/word/document.xml',data:'bad'}]},
 {label:'a symlink entry',entries:[{name:'word/document.xml',data:'target',externalFileAttributes:(0o120777<<16)>>>0}]},
 {label:'an encrypted entry',entries:[{name:'word/document.xml',data:'secret',flags:1}]},
 {label:'a strongly encrypted entry',entries:[{name:'word/document.xml',data:'secret',flags:0x40}]},
 {label:'a nonzero per-entry disk number',entries:[{name:'word/document.xml',data:'bad',diskStart:1}]},
 {label:'a nonzero central-directory disk number',entries:[{name:'word/document.xml',data:'bad'}],options:{centralDirectoryDisk:1}},
 {label:'a split archive',entries:[{name:'word/document.xml',data:'bad'}],options:{diskNumber:1}},
];

it.each(unsafeArchiveCases)('rejects $label with a fixed error',async({entries,options})=>{
 await expect(readSafeOfficeArchive(createImportZipFixture(entries,options))).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('rejects local and central header disagreement before returning a part',async()=>{
 const zip=archive([{name:'word/document.xml',data:'content',local:{name:'word/other.xml'}}]);
 await expect(readSafeOfficeArchive(zip)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('checks the actual CRC-32 instead of trusting matching header values',async()=>{
 const wrongCrc=crc32ForImportZip('content')^0xffffffff;
 const zip=archive([{name:'word/document.xml',data:'content',local:{crc32:wrongCrc},central:{crc32:wrongCrc}}]);
 await expect(readSafeOfficeArchive(zip)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('rejects unsafe declared sizes and inflated size mismatches',async()=>{
 const tooLarge=archive([{name:'word/document.xml',data:'x',local:{uncompressedSize:limitEntry+1},central:{uncompressedSize:limitEntry+1}}]);
 await expect(readSafeOfficeArchive(tooLarge)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
 const mismatched=archive([{name:'word/document.xml',data:'payload',local:{uncompressedSize:6},central:{uncompressedSize:6}}]);
 await expect(readSafeOfficeArchive(mismatched)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('caps entry count and declared total expansion before inflating package parts',async()=>{
 const tooMany=archive(Array.from({length:2001},(_,index)=>({name:`word/part-${index}.xml`,data:'',method:0 as const})));
 await expect(readSafeOfficeArchive(tooMany)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
 const declaredBody=Buffer.alloc(13*1024*1024,0x42),declaredCompressed=deflateRawSync(declaredBody);
 const tooMuchDeclared=archive(Array.from({length:5},(_,index)=>({name:`word/part-${index}.xml`,data:declaredBody,compressedData:declaredCompressed})));
 await expect(readSafeOfficeArchive(tooMuchDeclared)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('caps actual inflated bytes for one entry even when its declared size fits',async()=>{
 const body=Buffer.alloc(limitEntry+1,0x41),compressed=deflateRawSync(body);
 const zip=archive([{name:'word/document.xml',data:body,compressedData:compressed,
  local:{uncompressedSize:limitEntry},central:{uncompressedSize:limitEntry}}]);
 await expect(readSafeOfficeArchive(zip)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('caps the actual inflated total even when declared sizes fit exactly',async()=>{
 const body=Buffer.alloc(limitEntry,0x41),compressed=deflateRawSync(body);
 const entries:ImportZipEntryFixture[]=Array.from({length:4},(_,index)=>({name:`word/part-${index}.xml`,data:body,compressedData:compressed}));
 entries.push({name:'word/overflow.xml',data:'x',method:8,local:{uncompressedSize:0},central:{uncompressedSize:0}});
 const zip=archive(entries);
 await expect(readSafeOfficeArchive(zip)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

const activeArchiveCases:Array<{label:string;entries:ImportZipEntryFixture[]}>=
 [
  {label:'nested archive by name',entries:[{name:'word/embedded.zip',data:'not expanded'}]},
  {label:'nested archive by signature',entries:[{name:'word/embedded.bin',data:Buffer.from([0x50,0x4b,0x03,0x04,0,0,0,0])}]},
  {label:'macro executable part',entries:[{name:'word/vbaProject.bin',data:'executable'}]},
  {label:'macro-enabled content type',entries:[{name:'[Content_Types].xml',data:'<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>'}]},
  {label:'executable package part',entries:[{name:'word/launch.exe',data:'MZ'}]},
 ];

it.each(activeArchiveCases)('rejects $label with a fixed error',async({entries})=>{
 await expect(readSafeOfficeArchive(archive(entries))).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});

it('normalizes malformed archive and abort failures to the same fixed error',async()=>{
 await expect(readSafeOfficeArchive(Buffer.from('not a ZIP'))).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
 const controller=new AbortController();controller.abort();
 await expect(readSafeOfficeArchive(archive([{name:'word/document.xml',data:'content'}]),controller.signal)).rejects.toThrow('IMPORT_ARCHIVE_INVALID');
});
