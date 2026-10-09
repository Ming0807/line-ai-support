import {describe,it,expect} from 'vitest';
import {modelTestBlockReason} from '../app/(dashboard)/providers/model-test-availability';
const input={keyConfigured:true,cooling:false,pricingStatus:'UNKNOWN' as const,purpose:'GENERATION' as const,supportsJson:true,embeddingDimensions:null};
describe('selected model test admission in the UI',()=>{
 it('allows unknown or expired catalog observations because the server refreshes price before inference',()=>{
  expect(modelTestBlockReason(input)).toBeNull();expect(modelTestBlockReason({...input,pricingStatus:'FREE'})).toBeNull();
 });
 it('explains a missing key',()=>expect(modelTestBlockReason({...input,keyConfigured:false})).toMatch(/API key/));
 it('explains fresh paid evidence',()=>expect(modelTestBlockReason({...input,pricingStatus:'PAID'})).toMatch(/ค่าใช้จ่าย/));
 it('preserves the active model cooldown',()=>expect(modelTestBlockReason({...input,cooling:true})).toMatch(/รอ/));
 it('explains unsupported generation capability',()=>expect(modelTestBlockReason({...input,supportsJson:false})).toMatch(/JSON/));
 it('requires configured embedding dimensions for retained internal compatibility',()=>{
  expect(modelTestBlockReason({...input,purpose:'EMBEDDING'})).toMatch(/มิติ/);
  expect(modelTestBlockReason({...input,purpose:'EMBEDDING',embeddingDimensions:384})).toBeNull();
 });
});
