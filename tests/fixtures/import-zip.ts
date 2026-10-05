import {crc32,deflateRawSync} from 'node:zlib';

type HeaderOverrides={
 name?:string;
 flags?:number;
 method?:number;
 crc32?:number;
 compressedSize?:number;
 uncompressedSize?:number;
};

export interface ImportZipEntryFixture {
 name:string;
 data?:Uint8Array|string;
 method?:0|8;
 flags?:number;
 madeBy?:number;
 externalFileAttributes?:number;
 diskStart?:number;
 compressedData?:Uint8Array;
 local?:HeaderOverrides;
 central?:HeaderOverrides;
}

export interface ImportZipFixtureOptions {
 diskNumber?:number;
 centralDirectoryDisk?:number;
 entriesOnDisk?:number;
}

const utf8=(value:string)=>Buffer.from(value,'utf8');
const bytes=(value:Uint8Array|string|undefined)=>typeof value==='string'?utf8(value):Buffer.from(value??[]);
const field=(value:number)=>value>>>0;

/** Generates real ZIP local headers, compressed file data, central records and EOCD for parser tests. */
export function createImportZipFixture(entries:ImportZipEntryFixture[],options:ImportZipFixtureOptions={}):Buffer{
 const locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const entry of entries){
  const data=bytes(entry.data),method=entry.method??8,compressed=entry.compressedData?bytes(entry.compressedData):method===8?deflateRawSync(data):data;
  const checksum=crc32(data)>>>0,flags=entry.flags??0;
  const localName=utf8(entry.local?.name??entry.name),centralName=utf8(entry.central?.name??entry.name);
  const local=Buffer.alloc(30+localName.length+compressed.length),centralRecord=Buffer.alloc(46+centralName.length);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(entry.local?.flags??flags,6);
  local.writeUInt16LE(entry.local?.method??method,8);local.writeUInt32LE(field(entry.local?.crc32??checksum),14);
  local.writeUInt32LE(field(entry.local?.compressedSize??compressed.length),18);local.writeUInt32LE(field(entry.local?.uncompressedSize??data.length),22);
  local.writeUInt16LE(localName.length,26);local.writeUInt16LE(0,28);localName.copy(local,30);compressed.copy(local,30+localName.length);
  locals.push(local);

  centralRecord.writeUInt32LE(0x02014b50,0);centralRecord.writeUInt16LE(entry.madeBy??(3<<8|20),4);centralRecord.writeUInt16LE(20,6);
  centralRecord.writeUInt16LE(entry.central?.flags??flags,8);centralRecord.writeUInt16LE(entry.central?.method??method,10);
  centralRecord.writeUInt32LE(field(entry.central?.crc32??checksum),16);
  centralRecord.writeUInt32LE(field(entry.central?.compressedSize??compressed.length),20);
  centralRecord.writeUInt32LE(field(entry.central?.uncompressedSize??data.length),24);
  centralRecord.writeUInt16LE(centralName.length,28);centralRecord.writeUInt16LE(0,30);centralRecord.writeUInt16LE(0,32);
  centralRecord.writeUInt16LE(entry.diskStart??0,34);centralRecord.writeUInt16LE(0,36);
  centralRecord.writeUInt32LE(field(entry.externalFileAttributes??0),38);centralRecord.writeUInt32LE(offset,42);centralName.copy(centralRecord,46);
  central.push(centralRecord);offset+=local.length;
 }
 const centralBytes=Buffer.concat(central),localBytes=Buffer.concat(locals),eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(options.diskNumber??0,4);eocd.writeUInt16LE(options.centralDirectoryDisk??0,6);
 eocd.writeUInt16LE(options.entriesOnDisk??entries.length,8);eocd.writeUInt16LE(entries.length,10);
 eocd.writeUInt32LE(centralBytes.length,12);eocd.writeUInt32LE(localBytes.length,16);eocd.writeUInt16LE(0,20);
 return Buffer.concat([localBytes,centralBytes,eocd]);
}

export function crc32ForImportZip(data:Uint8Array|string):number{return crc32(bytes(data))>>>0;}
