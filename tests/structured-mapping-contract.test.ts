import {expect,it} from 'vitest';
import {computeStructuredMappingDigest,validateStructuredMapping,StructuredMappingError} from '../lib/imports/structured-mapping-contract';

const constant=(value:string|number|null)=>({kind:'CONSTANT',value,note:'explicit reviewed value'});
const column=(columnIndex:number,transform='TEXT_V1')=>({kind:'COLUMN',columnIndex,transform,blank:'REJECT'});
const mapping={version:1,registryVersion:'structured-v1',dataset:'academic_calendar_events',source:{jobId:'123e4567-e89b-42d3-a456-426614174000',jobRevision:2,extractionRevision:2,sourceChecksum:'a'.repeat(64),extractionDigest:'b'.repeat(64)},tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:2}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'header reviewed'}],fields:{academic_year:constant(2569),semester:constant('1'),student_type:constant('ALL'),event_type:constant('REGISTRATION'),title:column(0),start_date:column(1,'DATE_GREGORIAN_V1'),end_date:constant(null),description:constant(null)}}],excludedTables:[]};

it('validates strict source-bound mapping without granting readiness or accepting normalized rows',()=>{
 const parsed=validateStructuredMapping(mapping);
 expect(parsed).toEqual(mapping);expect(parsed).not.toBe(mapping);
 for(const extra of ['rows','approved','installed','document_id','sql'])expect(()=>validateStructuredMapping({...mapping,[extra]:[]})).toThrow(StructuredMappingError);
});
it('requires exactly source fields, compatible transforms and explicit nullable blank policy',()=>{
 const first=mapping.tables[0];
 for(const fields of [{...first.fields,id:constant('private')},{...first.fields,start_date:column(1,'TEXT_V1')},{...first.fields,title:{...column(0),blank:'NULL'}}])expect(()=>validateStructuredMapping({...mapping,tables:[{...first,fields}]})).toThrowError(/^STRUCTURED_MAPPING_INVALID$/);
 const {description:omitted,...missing}=first.fields;void omitted;
 expect(()=>validateStructuredMapping({...mapping,tables:[{...first,fields:missing}]})).toThrow(StructuredMappingError);
 const allRequiredConstants={...first.fields,title:constant('constant'),start_date:constant('2026-10-07'),description:{...column(0),blank:'NULL'}};
 expect(()=>validateStructuredMapping({...mapping,tables:[{...first,fields:allRequiredConstants}]})).toThrow(StructuredMappingError);
});
it('rejects duplicate tables, overlapping rows, reversed ranges and source-controlled identifiers',()=>{
 expect(()=>validateStructuredMapping({...mapping,tables:[mapping.tables[0],mapping.tables[0]]})).toThrow(StructuredMappingError);
 expect(()=>validateStructuredMapping({...mapping,excludedTables:[{tableIndex:0,reason:'NON_DATA',note:'skip'}]})).toThrow(StructuredMappingError);
 expect(()=>validateStructuredMapping({...mapping,tables:[{...mapping.tables[0],dataRanges:[{startRowIndex:2,endRowIndex:1}]}]})).toThrow(StructuredMappingError);
 expect(()=>validateStructuredMapping({...mapping,tables:[{...mapping.tables[0],excludedRanges:[{startRowIndex:1,endRowIndex:1,reason:'HEADER',note:'overlap'}]}]})).toThrow(StructuredMappingError);
});
it('canonicalizes property and selection order while retaining meaningful mapping choices in its digest',()=>{
 const parsed=validateStructuredMapping(mapping);
 const reordered={...mapping,tables:[{...mapping.tables[0],fields:Object.fromEntries(Object.entries(mapping.tables[0].fields).reverse())}]};
 expect(computeStructuredMappingDigest(validateStructuredMapping(reordered))).toBe(computeStructuredMappingDigest(parsed));
 expect(computeStructuredMappingDigest(validateStructuredMapping({...mapping,source:{...mapping.source,jobRevision:3}}))).not.toBe(computeStructuredMappingDigest(parsed));
});
it('rejects accessors/cycles/nonfinite values without running source callbacks or leaking private diagnostics',()=>{
 let reads=0;const getter={...mapping,get dataset(){reads++;return 'academic_calendar_events';}};
 expect(()=>validateStructuredMapping(getter)).toThrowError(/^STRUCTURED_MAPPING_INVALID$/);expect(reads).toBe(0);
 const cycle:Record<string,unknown>={...mapping};cycle.extra=cycle;
 for(const value of [cycle,{...mapping,version:Number.NaN},new Proxy(mapping,{ownKeys(){throw new Error('PRIVATE_SOURCE');}})])expect(()=>validateStructuredMapping(value)).toThrowError(/^STRUCTURED_MAPPING_INVALID$/);
});
it('rejects proxies before invoking reflection traps even when their apparent data is valid',()=>{
 let traps=0;
 const proxy=new Proxy(mapping,{getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);},ownKeys(target){traps++;return Reflect.ownKeys(target);}});
 expect(()=>validateStructuredMapping(proxy)).toThrowError(/^STRUCTURED_MAPPING_INVALID$/);expect(traps).toBe(0);
});
