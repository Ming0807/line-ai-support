import {expect,it,vi,beforeEach} from 'vitest';
import {GET} from '../app/api/knowledge/embedding/health/route';
import {ProviderAdminError} from '../lib/ai/provider-admin';

const mocks=vi.hoisted(()=>({staff:vi.fn(),authorize:vi.fn(),health:vi.fn()}));
vi.mock('../lib/tickets/api',()=>({apiStaffId:mocks.staff}));
vi.mock('../lib/ai/provider-admin',()=>({withProviderAdminTransaction:mocks.authorize,ProviderAdminError:class extends Error{constructor(readonly code:string){super(code);}}}));
vi.mock('../lib/knowledge/embedding-client',()=>({createLocalE5EmbeddingProvider:()=>({healthCheck:mocks.health})}));
beforeEach(()=>{mocks.staff.mockResolvedValue('00000000-0000-4000-8000-000000000001');mocks.authorize.mockResolvedValue(undefined);mocks.health.mockResolvedValue({healthy:true,model:'intfloat/multilingual-e5-small',dimension:384,mode:'Local',observedAt:'2026-10-05T16:00:00Z',httpStatus:200});});
it('denies unauthenticated/ordinary/inactive staff before network',async()=>{
 mocks.staff.mockResolvedValueOnce(null);expect((await GET()).status).toBe(401);
 mocks.authorize.mockRejectedValueOnce(new ProviderAdminError('FORBIDDEN'));expect((await GET()).status).toBe(403);
 expect(mocks.health).not.toHaveBeenCalled();
});
it('returns read-only safe health DTO and reauthorizes after network',async()=>{
 const response=await GET();expect(response.status).toBe(200);expect(mocks.authorize).toHaveBeenCalledTimes(2);
 const body=await response.json();expect(body.embedding).toMatchObject({healthy:true,dimension:384});
 expect(JSON.stringify(body)).not.toMatch(/apiUrl|127\.0\.0\.1|cache|apiKey|D:\\/);
});
it('does not return observations after permission revocation during the call',async()=>{
 mocks.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ProviderAdminError('FORBIDDEN'));
 expect((await GET()).status).toBe(403);expect(mocks.health).toHaveBeenCalledOnce();
});
it('reports infrastructure configuration failure with a fixed code only',async()=>{
 mocks.health.mockRejectedValueOnce(new Error('private endpoint/key'));
 const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'EMBEDDING_UNAVAILABLE'});
});
