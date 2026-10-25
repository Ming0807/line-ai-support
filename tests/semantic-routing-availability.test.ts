import {expect,it,vi} from 'vitest';
import {createSemanticRoutingClassifier} from '../lib/conversation/semantic-routing-provider';
import {AIProviderError} from '../lib/ai/types';

it.each(['TIMEOUT','AUTH_ERROR','RATE_LIMITED','PROVIDER_UNAVAILABLE'] as const)('distinguishes %s from a semantic ASK without exposing provider details',async code=>{
 const generate=vi.fn().mockRejectedValue(new AIProviderError(code));
 const classify=createSemanticRoutingClassifier(generate);
 await expect(classify({question:'แล้วเรื่องเดิมล่ะ',contexts:[]},new AbortController().signal))
  .rejects.toMatchObject({name:'SemanticRoutingUnavailableError',message:'ROUTING_UNAVAILABLE',reason:code});
 expect(generate).toHaveBeenCalledTimes(1);
});
it('keeps actual ASK as a semantic decision and malformed output as a rejected proposal',async()=>{
 const generate=vi.fn().mockResolvedValue({output:{decision:'ASK',candidateCode:null,confidence:.9},toolCalls:[]});
 const classify=createSemanticRoutingClassifier(generate),signal=new AbortController().signal;
 await expect(classify({question:'เรื่องนั้น',contexts:[]},signal)).resolves.toMatchObject({decision:'ASK'});
 generate.mockResolvedValue({output:{decision:'INVENTED'},toolCalls:[]});
 await expect(classify({question:'เรื่องนั้น',contexts:[]},signal)).resolves.toBeNull();
});
