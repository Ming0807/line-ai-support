import {expect,it,vi} from 'vitest';
import {parseImportSource} from '../lib/imports/parse-source';
import {executeParserChild} from '../lib/imports/parser-process';
import {createImportSource} from '../lib/imports/source';
import {parseCsvSource} from '../lib/imports/csv-parser';
vi.mock('../lib/imports/parser-process',()=>({executeParserChild:vi.fn()}));
const source=()=>createImportSource({bytes:Buffer.from('a,b\nx,001'),filename:'test.csv',mimeType:'',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
it('rejects a valid result that completes after the total15s parent deadline',async()=>{
 const input=source(),output=JSON.stringify({schemaVersion:1,extraction:parseCsvSource(input)}),clock=vi.spyOn(performance,'now').mockReturnValue(0);
 vi.mocked(executeParserChild).mockImplementation(async()=>{clock.mockReturnValue(15001);return output;});
 await expect(parseImportSource(input)).rejects.toThrow(/^IMPORT_PARSER_TIMEOUT$/);
});
it('does not return parsed data after cancellation at the child-to-parent boundary',async()=>{
 const input=source(),controller=new AbortController(),output=JSON.stringify({schemaVersion:1,extraction:parseCsvSource(input)});
 vi.mocked(executeParserChild).mockImplementation(async()=>{controller.abort();return output;});
 await expect(parseImportSource(input,controller.signal)).rejects.toThrow(/^IMPORT_PARSER_ABORTED$/);
});
it('counts parent source/protocol work in the remaining child deadline',async()=>{
 const input=source(),output=JSON.stringify({schemaVersion:1,extraction:parseCsvSource(input)}),clock=vi.spyOn(performance,'now');
 let calls=0;clock.mockImplementation(()=>++calls===1?0:1000);
 vi.mocked(executeParserChild).mockResolvedValue(output);
 await parseImportSource(input);expect(vi.mocked(executeParserChild).mock.calls.at(-1)?.[1].timeoutMs).toBe(14000);
});
