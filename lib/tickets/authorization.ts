import type {PoolClient} from 'pg';
import type {StaffIdentity} from '../auth/staff';

export type DbClient=Pick<PoolClient,'query'>;
export class TicketError extends Error {
 constructor(public code:'NOT_FOUND'|'CONFLICT'|'INVALID_ACTION'|'INVALID_REQUEST'){super(code);}
}
// Keep the same explicit Admin/sensitivity rules as private.can_access_scope; no home-department Admin shortcut.
export const eligibleScopeSql=`s.active and (s.role='SUPER_ADMIN'
 or (s.role='ADMIN' and exists(select 1 from public.staff_department_grants g where g.staff_id=s.id and g.department_id=$1))
 or (s.role in ('STAFF','SUPERVISOR') and s.department_id=$1))
 and ($2='GENERAL' or s.role='SUPER_ADMIN' or ($2='SENSITIVE' and s.can_view_sensitive) or ($2='RESTRICTED' and s.can_view_restricted))`;
export async function loadActor(client:DbClient,staffId:string):Promise<StaffIdentity> {
 const row=(await client.query('select * from public.staff_profiles where id=$1 and active for share',[staffId])).rows[0];
 if(!row)throw new TicketError('NOT_FOUND');
 await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:staffId,role:'authenticated'})]);
 // Lock explicit grants for this transaction so a concurrent revocation waits for the authorized mutation.
 await client.query('select department_id from public.staff_department_grants where staff_id=$1 for share',[staffId]);
 return row;
}
export async function authorizeScope(client:DbClient,departmentId:string,sensitivity:string):Promise<void> {
 if(!(await client.query('select private.can_access_scope($1,$2) as allowed',[departmentId,sensitivity])).rows[0].allowed)throw new TicketError('NOT_FOUND');
}
export function isSupervisor(actor:StaffIdentity):boolean {return ['SUPERVISOR','ADMIN','SUPER_ADMIN'].includes(actor.role);}
export async function lockConversation(client:DbClient,conversationId:string):Promise<void> {
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`conversation:${conversationId}`]);
}
