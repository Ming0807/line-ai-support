import {expect,it} from 'vitest';
import {datasetTypes} from '../lib/imports/types';
import {STRUCTURED_DATASETS,StructuredPayloadError,structuredPayloadSchemas} from '../lib/knowledge/structured-payload';
import {getStructuredRegistryEntry} from '../lib/knowledge/structured-registry';

it('describes exactly the seven source payloads without claiming a database installation',()=>{
 expect(STRUCTURED_DATASETS).toEqual(datasetTypes);
 for(const dataset of STRUCTURED_DATASETS){
  const entry=getStructuredRegistryEntry(dataset);
  expect(entry.dataset).toBe(dataset);expect(entry.version).toBe('structured-v1');expect(entry.installed).toBe(false);
  expect(entry.fields.map(field=>field.name)).toEqual(Object.keys(structuredPayloadSchemas[dataset].shape));
  expect(new Set(entry.fields.map(field=>field.name)).size).toBe(entry.fields.length);
  expect(Object.keys(entry).sort()).toEqual(['dataset','fields','installed','version']);
 }
});
it('distinguishes exact decimals, civil dates, UTC timestamps and reviewed integer bounds',()=>{
 const fees=getStructuredRegistryEntry('tuition_fees');
 expect(fees.fields.find(field=>field.name==='fee_amount')).toEqual({name:'fee_amount',kind:'DECIMAL',nullable:false,precision:12,scale:2});
 expect(fees.fields.find(field=>field.name==='effective_to')).toEqual({name:'effective_to',kind:'DATE',nullable:true});
 expect(fees.fields.find(field=>field.name==='academic_year')).toEqual({name:'academic_year',kind:'INTEGER',nullable:false,min:2400,max:3000});
 expect(fees.fields.find(field=>field.name==='currency')).toEqual({name:'currency',kind:'CURRENCY',nullable:false,maxLength:3});
 expect(getStructuredRegistryEntry('transfer_courses').fields.find(field=>field.name==='source_credits')).toEqual({name:'source_credits',kind:'DECIMAL',nullable:false,precision:6,scale:3});
 const announcements=getStructuredRegistryEntry('announcements');
 expect(announcements.fields.find(field=>field.name==='publish_at')?.kind).toBe('TIMESTAMP');
 expect(announcements.fields.find(field=>field.name==='priority')).toEqual({name:'priority',kind:'INTEGER',nullable:false,min:0,max:100});
});
it('exposes source text opening hours and nullable contact fields without inventing backend fields',()=>{
 const fields=getStructuredRegistryEntry('university_services').fields;
 expect(fields.find(field=>field.name==='opening_hours')).toEqual({name:'opening_hours',kind:'TEXT',nullable:true,maxLength:2000});
 expect(fields.find(field=>field.name==='email')).toEqual({name:'email',kind:'EMAIL',nullable:true,maxLength:254});
 expect(getStructuredRegistryEntry('university_systems').fields.find(field=>field.name==='url')).toEqual({name:'url',kind:'URL',nullable:false,maxLength:2000});
 for(const dataset of STRUCTURED_DATASETS)for(const name of ['id','document_id','department_id','active','is_current','sql','table','payload_digest'])expect(getStructuredRegistryEntry(dataset).fields.some(field=>field.name===name)).toBe(false);
});
it('freezes every entry, array and field so callers cannot enable or corrupt readiness',()=>{
 for(const dataset of STRUCTURED_DATASETS){
  const entry=getStructuredRegistryEntry(dataset);
  expect(Object.isFrozen(entry)).toBe(true);expect(Object.isFrozen(entry.fields)).toBe(true);
  expect(entry.fields.every(field=>Object.isFrozen(field))).toBe(true);
  expect(Reflect.set(entry,'installed',true)).toBe(false);
  expect(Reflect.set(entry.fields,0,{name:'sql',kind:'TEXT',nullable:false})).toBe(false);
  expect(Reflect.set(entry.fields[0],'name','document_id')).toBe(false);
  expect(getStructuredRegistryEntry(dataset)).toBe(entry);
  expect(getStructuredRegistryEntry(dataset).installed).toBe(false);
 }
});
it('rejects unknown/prototype/nonstring selectors without invoking caller coercion or leaking values',()=>{
 const selector={toString(){throw new Error('PRIVATE_SELECTOR_READ');}};
 for(const value of ['__proto__','constructor','toString','tuition_fees; DROP TABLE x','private text',null,1,selector]){
  expect(()=>getStructuredRegistryEntry(value)).toThrowError(/^STRUCTURED_DATASET_UNSUPPORTED$/);
  expect(()=>getStructuredRegistryEntry(value)).toThrow(StructuredPayloadError);
 }
});
