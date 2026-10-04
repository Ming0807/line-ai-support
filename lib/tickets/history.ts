import type {DbClient} from './authorization';
export async function recordTicketHistory(client:DbClient,input:{ticketId:string;action:string;from?:string;to?:string;actorType:'STAFF'|'USER'|'SYSTEM'|'AI';actorId?:string;reason?:string}):Promise<void> {
 const metadata=input.reason?{reason:input.reason}:{};
 await client.query('insert into public.ticket_history(ticket_id,action,from_status,to_status,actor_type,actor_id,metadata) values($1,$2,$3,$4,$5,$6,$7)',[input.ticketId,input.action,input.from??null,input.to??null,input.actorType,input.actorId??null,metadata]);
 await client.query('insert into private.activities(ticket_id,actor_id,action,metadata) values($1,$2,$3,$4)',[input.ticketId,input.actorId??null,input.action,{}]);
}
