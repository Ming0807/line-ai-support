import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {executeParserChild} from '../lib/imports/parser-process';
import {encodeParserRequest,decodeParserRequest} from '../lib/imports/parser-child-protocol';
import {createImportSource} from '../lib/imports/source';
const script=resolve('tests/fixtures/parser-child.mjs');
const run=(mode:string,options:{timeoutMs?:number;signal?:AbortSignal}={})=>executeParserChild(Buffer.from(JSON.stringify({mode})),{scriptPath:script,...options});
it('runs a real hidden Node child with a256MiB heap and credential-free environment',async()=>{
 process.env.YRU_TEST_SENTINEL_SECRET='dummy-only';
 try{
  const result=JSON.parse(await run('env'));
  expect(result.heap).toBe(true);expect(result.keys).not.toContain('YRU_TEST_SENTINEL_SECRET');
  expect(result.keys).not.toContain('NODE_OPTIONS');expect(result.keys).not.toContain('DATABASE_URL');expect(result.keys).not.toContain('HTTP_PROXY');
  expect(result.keys).toEqual(expect.arrayContaining(['NODE_ENV','TSX_DISABLE_CACHE']));
 }finally{delete process.env.YRU_TEST_SENTINEL_SECRET;}
});
it('kills and observes close of a real hung child on the total deadline',async()=>{
 const start=Date.now();await expect(run('hang',{timeoutMs:500})).rejects.toThrow(/^IMPORT_PARSER_TIMEOUT$/);expect(Date.now()-start).toBeLessThan(5000);
});
it('caps actual32MiB stdout before buffering over the limit',async()=>{await expect(run('output')).rejects.toThrow(/^IMPORT_PARSER_OUTPUT_LIMIT$/);});
it('caps stderr without returning uploaded content or parser stacks',async()=>{
 await expect(run('stderr')).rejects.toThrow(/^IMPORT_PARSER_OUTPUT_LIMIT$/);
 await expect(run('fail')).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
});
it('rejects malformed UTF8 stdout and handles missing scripts with fixed failure',async()=>{
 await expect(run('utf8')).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
 await expect(executeParserChild(Buffer.from('{}'),{scriptPath:resolve('tests/fixtures/not-a-parser.mjs')})).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
});
it('cancels before spawn and while the actual process is running',async()=>{
 await expect(run('hang',{signal:AbortSignal.abort()})).rejects.toThrow(/^IMPORT_PARSER_ABORTED$/);
 const controller=new AbortController(),pending=run('hang',{signal:controller.signal});setTimeout(()=>controller.abort(),200);
 await expect(pending).rejects.toThrow(/^IMPORT_PARSER_ABORTED$/);
});
it('does not let trusted configuration exceed runtime deadline or use relative scripts',async()=>{
 await expect(run('closed',{timeoutMs:15001})).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
 await expect(executeParserChild(Buffer.from('{}'),{scriptPath:'uploaded.mjs'})).rejects.toThrow(/^IMPORT_PARSER_FAILED$/);
});
it('roundtrips bounded metadata+raw immutable bytes and validates checksum/length/format',()=>{
 const source=createImportSource({bytes:Buffer.from('รายการ,ค่าใช้จ่าย\nสมัคร,001.230\n'),filename:'fixed.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const request=encodeParserRequest(source),decoded=decodeParserRequest(request);expect(decoded).toEqual(source);
 const changed=Uint8Array.from(request);changed[changed.length-1]^=1;expect(()=>decodeParserRequest(changed)).toThrow(/^IMPORT_PARSE_INVALID$/);
 expect(()=>decodeParserRequest(new Uint8Array(8193).fill(65))).toThrow(/^IMPORT_PARSE_INVALID$/);
 expect(()=>decodeParserRequest(request.subarray(0,request.length-1))).toThrow(/^IMPORT_PARSE_INVALID$/);
 expect(()=>decodeParserRequest(Buffer.from('{"filename":"oops.csv","secret":"private"}\nbytes'))).toThrow(/^IMPORT_PARSE_INVALID$/);
});
