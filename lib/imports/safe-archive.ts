import {crc32} from 'node:zlib';
import {Readable} from 'node:stream';
import yauzl from 'yauzl';

const MAX_ARCHIVE_BYTES=20*1024*1024;
const MAX_ENTRIES=2_000;
const MAX_ENTRY_BYTES=16*1024*1024;
const MAX_TOTAL_BYTES=64*1024*1024;
const CENTRAL_SIGNATURE=0x02014b50;
const END_SIGNATURE=0x06054b50;
const ZIP64_LOCATOR_SIGNATURE=0x07064b50;
const BLOCKED_PART_EXTENSIONS=new Set(['.zip','.jar','.7z','.rar','.tar','.gz','.tgz','.bz2','.xz','.zst','.cab','.iso',
 '.exe','.dll','.com','.bat','.cmd','.ps1','.psm1','.psd1','.sh','.so','.dylib','.msi','.scr','.class','.wasm','.bin',
 '.js','.mjs','.cjs','.vbs','.vbe','.jse','.wsf','.wsh','.hta','.py','.rb','.pl','.php','.docm','.dotm','.xlsm',
 '.xltm','.pptm','.potm','.ppsm','.ppam']);
const invalid=()=>new Error('IMPORT_ARCHIVE_INVALID');
function ensure(condition:boolean):asserts condition{if(!condition)throw invalid();}

interface ArchivePart {
 entry:yauzl.Entry;
 name:string;
 isDirectory:boolean;
}

/** Checks ZIP directory fields yauzl intentionally leaves to callers, including entry start disks. */
function validateSingleDiskDirectory(buffer:Buffer):number{
 ensure(buffer.length>=22);
 const first=Math.max(0,buffer.length-22-0xffff);let endOffset=-1;
 for(let offset=buffer.length-22;offset>=first;offset--){
  if(buffer.readUInt32LE(offset)!==END_SIGNATURE)continue;
  const commentLength=buffer.readUInt16LE(offset+20);
  if(offset+22+commentLength===buffer.length){endOffset=offset;break;}
 }
 ensure(endOffset>=0);
 const diskNumber=buffer.readUInt16LE(endOffset+4),directoryDisk=buffer.readUInt16LE(endOffset+6);
 const entriesOnDisk=buffer.readUInt16LE(endOffset+8),entryCount=buffer.readUInt16LE(endOffset+10);
 const directorySize=buffer.readUInt32LE(endOffset+12),directoryOffset=buffer.readUInt32LE(endOffset+16);
 ensure(diskNumber===0&&directoryDisk===0&&entriesOnDisk===entryCount);
 // The archive and expansion limits are far below ZIP64 thresholds, so reject ZIP64 instead of
 // accepting directory disk fields that this bounded reader cannot independently validate.
 ensure(entriesOnDisk!==0xffff&&entryCount!==0xffff&&directorySize!==0xffffffff&&directoryOffset!==0xffffffff);
 ensure(endOffset<20||buffer.readUInt32LE(endOffset-20)!==ZIP64_LOCATOR_SIGNATURE);
 ensure(entryCount<=MAX_ENTRIES&&directoryOffset+directorySize===endOffset&&directoryOffset<=buffer.length);
 let offset=directoryOffset;
 for(let index=0;index<entryCount;index++){
  ensure(offset+46<=endOffset&&buffer.readUInt32LE(offset)===CENTRAL_SIGNATURE);
  const nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32);
  const recordLength=46+nameLength+extraLength+commentLength;
  ensure(offset+recordLength<=endOffset&&buffer.readUInt16LE(offset+34)===0);
  offset+=recordLength;
 }
 ensure(offset===endOffset);
 return entryCount;
}

function safePartName(value:string):{name:string;key:string;isDirectory:boolean}{
 ensure(value.length>0&&value.length<=1024&&!/[\\\x00-\x1f\x7f]/.test(value));
 ensure(yauzl.validateFileName(value)===null&&value.normalize('NFC')===value);
 const isDirectory=value.endsWith('/'),name=isDirectory?value.slice(0,-1):value;
 ensure(name.length>0&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.includes(':'));
 const segments=name.split('/');
 ensure(segments.every(segment=>segment.length>0&&segment!=='.'&&segment!=='..'&&!/[. ]$/.test(segment)));
 return {name:value,key:name.toLowerCase(),isDirectory};
}

function validateEntryMetadata(entry:yauzl.Entry,name:string,isDirectory:boolean):void{
 const flags=entry.generalPurposeBitFlag;
 const allowedFlags=0x0006|0x0008|0x0800;
 ensure((flags&~allowedFlags)===0);
 ensure(entry.compressionMethod===0||entry.compressionMethod===8);
 ensure(entry.canDecodeFileData()&&!entry.isEncrypted());
 ensure(Number.isSafeInteger(entry.compressedSize)&&entry.compressedSize>=0&&entry.compressedSize<=MAX_ARCHIVE_BYTES);
 ensure(Number.isSafeInteger(entry.uncompressedSize)&&entry.uncompressedSize>=0&&entry.uncompressedSize<=MAX_ENTRY_BYTES);
 ensure(Number.isInteger(entry.crc32)&&entry.crc32>=0&&entry.crc32<=0xffffffff);

 const hostSystem=entry.versionMadeBy>>>8,unixType=(entry.externalFileAttributes>>>16)&0xf000;
 ensure(unixType!==0xa000&&(entry.externalFileAttributes&0x400)===0);
 if(hostSystem===3&&unixType!==0)ensure(unixType===0x8000||unixType===0x4000);
 if(unixType===0x4000||(entry.externalFileAttributes&0x10)!==0)ensure(isDirectory);
 if(unixType===0x8000)ensure(!isDirectory);

 const lower=name.toLowerCase(),suffix=lower.split('/').at(-1)??'';
 ensure(![...BLOCKED_PART_EXTENSIONS].some(extension=>suffix.endsWith(extension)));
 ensure(!/(?:^|\/)(?:vbaproject|macrosheets?|activex)(?:\/|\.|$)/i.test(name));
}

function validateLocalHeader(entry:yauzl.Entry,header:yauzl.LocalFileHeader):void{
 ensure(header.fileName.equals(entry.fileNameRaw));
 ensure(header.generalPurposeBitFlag===entry.generalPurposeBitFlag&&header.compressionMethod===entry.compressionMethod);
 const hasDataDescriptor=(entry.generalPurposeBitFlag&0x0008)!==0;
 const agrees=(local:number,central:number)=>local===central||(hasDataDescriptor&&local===0);
 ensure(agrees(header.crc32,entry.crc32)&&agrees(header.compressedSize,entry.compressedSize)&&agrees(header.uncompressedSize,entry.uncompressedSize));
}

function rejectActivePart(name:string,data:Buffer):void{
 const lower=name.toLowerCase();
 const signatures=[
  [0x50,0x4b,0x03,0x04],[0x50,0x4b,0x05,0x06],[0x50,0x4b,0x07,0x08],
  [0x37,0x7a,0xbc,0xaf,0x27,0x1c],[0x52,0x61,0x72,0x21,0x1a,0x07],
  [0x1f,0x8b],[0xfd,0x37,0x7a,0x58,0x5a],[0x28,0xb5,0x2f,0xfd],
  [0x4d,0x5a],[0x7f,0x45,0x4c,0x46],[0x23,0x21],[0x00,0x61,0x73,0x6d],
  [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],
 ];
 ensure(!signatures.some(signature=>signature.every((byte,index)=>data[index]===byte)));
 if(data.length>=262)ensure(!data.subarray(257,262).equals(Buffer.from('ustar')));
 if(lower.endsWith('/[content_types].xml')||lower==='[content_types].xml'){
  const contentTypes=data.toString('utf8').toLowerCase();
  ensure(!/(?:macroenabled|vbaproject|macrosheet)/.test(contentTypes));
 }
}

async function readPart(stream:Readable,part:ArchivePart,signal:AbortSignal|undefined,total:{bytes:number}):Promise<Buffer>{
 const chunks:Buffer[]=[];let size=0,checksum=0;
 const abort=()=>stream.destroy(invalid());
 signal?.addEventListener('abort',abort,{once:true});
 try{
  for await(const value of stream){
   ensure(!signal?.aborted);
   const chunk=Buffer.isBuffer(value)?value:Buffer.from(value as Uint8Array);
   size+=chunk.length;total.bytes+=chunk.length;
   ensure(size<=MAX_ENTRY_BYTES&&size<=part.entry.uncompressedSize&&total.bytes<=MAX_TOTAL_BYTES);
   checksum=crc32(chunk,checksum)>>>0;chunks.push(chunk);
  }
 }catch{throw invalid();}
 finally{signal?.removeEventListener('abort',abort);}
 ensure(size===part.entry.uncompressedSize&&checksum===part.entry.crc32);
 const data=Buffer.concat(chunks,size);
 rejectActivePart(part.name,data);
 return data;
}

/** Reads an Office ZIP package in memory with strict expansion and part validation. */
export async function readSafeOfficeArchive(bytes:Uint8Array,signal?:AbortSignal):Promise<ReadonlyMap<string,Uint8Array>>{
 try{
  ensure(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=MAX_ARCHIVE_BYTES&&!signal?.aborted);
  const buffer=Buffer.from(bytes),directoryCount=validateSingleDiskDirectory(buffer);
  const zipfile=await yauzl.fromBufferPromise(buffer,{lazyEntries:true,decodeStrings:true,strictFileNames:true,validateEntrySizes:true,autoClose:false});
  try{
   ensure(zipfile.entryCount===directoryCount&&zipfile.entryCount<=MAX_ENTRIES&&!signal?.aborted);
   const parts:ArchivePart[]=[],seen=new Set<string>(),fileKeys=new Set<string>();let declaredBytes=0;
   for await(const entry of zipfile.eachEntry()){
    ensure(!signal?.aborted&&parts.length<MAX_ENTRIES);
    const safe=safePartName(entry.fileName);
    ensure(!seen.has(safe.key));seen.add(safe.key);
    validateEntryMetadata(entry,safe.name,safe.isDirectory);
    const ancestorParts=safe.key.split('/');
    for(let index=1;index<ancestorParts.length;index++)ensure(!fileKeys.has(ancestorParts.slice(0,index).join('/')));
    if(safe.isDirectory)ensure(entry.compressedSize===0&&entry.uncompressedSize===0&&entry.crc32===0);
    if(!safe.isDirectory){
     ensure(![...seen].some(key=>key!==safe.key&&key.startsWith(`${safe.key}/`)));
     fileKeys.add(safe.key);
     declaredBytes+=entry.uncompressedSize;ensure(declaredBytes<=MAX_TOTAL_BYTES);
    }
    const header=await zipfile.readLocalFileHeaderPromise(entry);
    validateLocalHeader(entry,header);
    parts.push({entry,name:safe.name,isDirectory:safe.isDirectory});
   }
   const output=new Map<string,Uint8Array>(),total={bytes:0};
   for(const part of parts){
    ensure(!signal?.aborted);
    if(part.isDirectory)continue;
    const stream=await zipfile.openReadStreamPromise(part.entry);
    const data=await readPart(stream,part,signal,total);
    output.set(part.name,new Uint8Array(data));
   }
   ensure(!signal?.aborted);
   return output;
  }finally{zipfile.close();}
 }catch{throw invalid();}
}
