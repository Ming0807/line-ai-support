import {describe,expect,it} from 'vitest';
import {isEmbeddingDimensionAllowed} from '../lib/ai/embedding-models';

describe('native embedding model dimension configuration',()=>{
 it.each([
  ['text-embedding-ada-002',1536,true],['text-embedding-ada-002',2,false],
  ['text-embedding-3-small',1536,true],['text-embedding-3-small',1537,false],['text-embedding-3-small',4096,false],
  ['text-embedding-3-large',3072,true],['text-embedding-3-large',3073,false],['text-embedding-3-large',256,true],
  ['future-explicit-embedding-model',4096,true],['future-explicit-embedding-model',4097,false],
  ['future-explicit-embedding-model',0,false],['future-explicit-embedding-model',NaN,false],
 ])('validates %s dimensions %i without guessing unknown model defaults',(model,dimensions,expected)=>
  expect(isEmbeddingDimensionAllowed(model,dimensions)).toBe(expected));
});
