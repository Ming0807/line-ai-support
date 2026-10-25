import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {publishOwnedAssistantSources} from '../scripts/qa/assistant-owned-publication';

it('rejects cross-case source publication before touching the synthetic database',async()=>{
 const query=vi.fn();
 const pool={query} as unknown as Pool;
 await expect(publishOwnedAssistantSources({pool,key:'test',actor:'test',database:'yru_structured_schema_0123456789ab',
  caseIds:['A14','A15'],companion:{},frozenText:'',embeddingProvider:{} as never})).rejects.toThrow('OWNED_PUBLICATION_CASE_ISOLATION_REQUIRED');
 expect(query).not.toHaveBeenCalled();
});
