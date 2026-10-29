import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createUserClient:async()=>({auth:{getUser:mocks.getUser}})}));
import {getVerifiedStaffAuth} from '@/lib/auth/line-staff-server';
beforeEach(()=>vi.resetAllMocks());
it('does not turn a rate-limited or denied Auth verification into anonymous authority',async()=>{
 for(const status of [429,403,400,503]){
  mocks.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthApiError',status}});
  await expect(getVerifiedStaffAuth()).rejects.toMatchObject({code:'UNAVAILABLE'});
 }
});
it('recognizes the installed SDK missing-session error without exposing provider error details',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError',status:400}});
 expect(await getVerifiedStaffAuth()).toBeNull();
});
