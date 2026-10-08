import {expect,it} from 'vitest';
import {structuredAvailabilitySchema} from '../lib/knowledge/structured-availability';
import {STRUCTURED_DATASETS} from '../lib/knowledge/structured-payload';
it('requires the complete installed registry for a positive publication status',()=>{
 expect(structuredAvailabilitySchema.parse({available:false,datasets:[],registryVersion:'structured-v1'}).available).toBe(false);
 expect(structuredAvailabilitySchema.parse({available:true,datasets:[...STRUCTURED_DATASETS],registryVersion:'structured-v1'}).available).toBe(true);
 for(const value of [{available:true,datasets:[],registryVersion:'structured-v1'},{available:false,datasets:[...STRUCTURED_DATASETS],registryVersion:'structured-v1'},{available:true,datasets:[...STRUCTURED_DATASETS.slice(1),STRUCTURED_DATASETS[1]],registryVersion:'structured-v1'},{available:true,datasets:[...STRUCTURED_DATASETS],registryVersion:'unknown'}])expect(structuredAvailabilitySchema.safeParse(value).success).toBe(false);
});
