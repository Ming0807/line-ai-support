import {expect,it} from 'vitest';
import {createProviderSchema,createModelSchema} from '../types/providers';
const input={name:'Fixture',adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',enabled:true,priority:1,apiKey:'fixture-key'};
it('defaults provider creation to FREE_ONLY and permits only explicit paid opt-in',()=>{
 expect(createProviderSchema.parse(input).costMode).toBe('FREE_ONLY');
 expect(createProviderSchema.parse({...input,costMode:'ALLOW_PAID'}).costMode).toBe('ALLOW_PAID');
 expect(createProviderSchema.safeParse({...input,costMode:'AUTO'}).success).toBe(false);
});
it.each([
 ['ZEN','https://opencode.ai/zen/v1'],['OPENROUTER','https://openrouter.ai/api/v1'],['OPENAI','https://api.openai.com/v1'],
])('accepts only the official endpoint for %s', (adapter,baseUrl)=>{
 expect(createProviderSchema.safeParse({...input,adapter,baseUrl}).success).toBe(true);
 expect(createProviderSchema.safeParse({...input,adapter,baseUrl:`${baseUrl}/`}).success).toBe(true);
 expect(createProviderSchema.safeParse({...input,adapter,baseUrl:'https://attacker.example/v1'}).success).toBe(false);
});
it('rejects cross-provider hosts and unknown adapters',()=>{
 expect(createProviderSchema.safeParse({...input,adapter:'ZEN'}).success).toBe(false);
 expect(createProviderSchema.safeParse({...input,adapter:'DYNAMIC'}).success).toBe(false);
});
it('accepts a slash model ID and explicitly configured vectors without inferring dimensions',()=>{
 const embedding={modelId:'fixture/embedding-free',displayName:'Fixture',purpose:'EMBEDDING',embeddingDimensions:3,
  supportsJson:false,supportsTools:false,supportsVision:false,enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:null,outputPricePerMillion:null};
 expect(createModelSchema.safeParse(embedding).success).toBe(true);
 expect(createModelSchema.safeParse({...embedding,embeddingDimensions:null}).success).toBe(false);
 expect(createModelSchema.safeParse({...embedding,modelId:'fixture//model'}).success).toBe(false);
});
