import {createUserClient} from '../supabase/server';
import {StaffApplicationError} from '../staff/applications-contracts';
import {projectVerifiedLineStaffUser,type VerifiedStaffAuth} from './line-staff';

/** Network authentication happens before the business transaction. */
export async function getVerifiedStaffAuth():Promise<VerifiedStaffAuth|null> {
 const client=await createUserClient();
 const {data,error}=await client.auth.getUser();
 if(error){
  if(error.name==='AuthSessionMissingError'&&error.status===400)return null;
  throw new StaffApplicationError('UNAVAILABLE');
 }
 if(!data.user)return null;
 const auth=projectVerifiedLineStaffUser(data.user);
 if(!auth)throw new StaffApplicationError('IDENTITY_CHANGED');return auth;
}
