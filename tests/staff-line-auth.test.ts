import {expect,it} from 'vitest';
import {projectVerifiedLineStaffUser} from '@/lib/auth/line-staff';

const userId='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const identityId='e3490a61-8d27-4b60-b7d6-80bd75854138';
const subject='U'+'a'.repeat(32);
const lineIdentity={
  id:subject,
  provider:'custom:line-staff',
  identity_id:identityId,
  user_id:userId,
  identity_data:{sub:subject},
};

it('projects a verified Auth user with one matching LINE identity into the narrow server type',()=>{
  expect(projectVerifiedLineStaffUser({id:userId,identities:[lineIdentity]})).toEqual({
    userId,lineIdentity:{identityId,subject},
  });
});

it('preserves a verified Auth subject without claiming LINE linkage when identities are absent or empty',()=>{
  expect(projectVerifiedLineStaffUser({id:userId})).toEqual({userId,lineIdentity:null});
  expect(projectVerifiedLineStaffUser({id:userId,identities:[]})).toEqual({userId,lineIdentity:null});
});

it('does not derive LINE identity or role from editable user or app metadata',()=>{
  const spoofed={
    id:userId,
    user_metadata:{sub:subject,provider:'custom:line-staff',role:'SUPER_ADMIN'},
    app_metadata:{provider:'custom:line-staff',role:'SUPER_ADMIN',line_subject:subject},
  };
  expect(projectVerifiedLineStaffUser(spoofed)).toEqual({userId,lineIdentity:null});
});

it('rejects anonymous users and malformed Auth user ids',()=>{
  expect(projectVerifiedLineStaffUser({id:userId,is_anonymous:true,identities:[lineIdentity]})).toBeNull();
  expect(projectVerifiedLineStaffUser({id:'not-a-uuid'})).toBeNull();
  expect(projectVerifiedLineStaffUser(null)).toBeNull();
  expect(projectVerifiedLineStaffUser('user')).toBeNull();
});

it('rejects duplicate custom LINE identities rather than selecting one',()=>{
  const second={...lineIdentity,identity_id:'91e74be8-857d-4e89-9915-05ce51daf8fc',id:'U'+'b'.repeat(32),identity_data:{sub:'U'+'b'.repeat(32)}};
  expect(projectVerifiedLineStaffUser({id:userId,identities:[lineIdentity,second]})).toBeNull();
});

it('rejects LINE identities whose owner, identity UUID, provider subject or LINE subject disagree',()=>{
  const mismatches=[
    {...lineIdentity,user_id:'91e74be8-857d-4e89-9915-05ce51daf8fc'},
    {...lineIdentity,identity_id:'not-a-uuid'},
    {...lineIdentity,id:'U'+'b'.repeat(32)},
    {...lineIdentity,identity_data:{sub:'U'+'b'.repeat(32)}},
    {...lineIdentity,id:'not-a-line-subject',identity_data:{sub:'not-a-line-subject'}},
  ];
  for(const identity of mismatches) {
    expect(projectVerifiedLineStaffUser({id:userId,identities:[identity]})).toBeNull();
  }
});

it('ignores unrelated provider identities while requiring a single valid LINE identity',()=>{
  const unrelated={id:'google-user',provider:'google',identity_id:'not-relevant'};
  expect(projectVerifiedLineStaffUser({id:userId,identities:[unrelated,lineIdentity]})).toEqual({
    userId,lineIdentity:{identityId,subject},
  });
});

it('does not treat a noncustom provider alias as a LINE identity or account-link grant',()=>{
  expect(projectVerifiedLineStaffUser({id:userId,identities:[{...lineIdentity,provider:'line'}]})).toEqual({
    userId,lineIdentity:null,
  });
});
