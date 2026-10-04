import {TicketError,type DbClient} from './authorization';
export async function resolveDepartment(client:DbClient,code:string):Promise<{id:string;name_th:string}> {
 if(!/^[A-Z_]{2,40}$/.test(code))throw new TicketError('INVALID_REQUEST');
 const department=(await client.query('select id,name_th from public.departments where code=$1 and active for share',[code])).rows[0];
 if(!department)throw new TicketError('INVALID_REQUEST');return department;
}
