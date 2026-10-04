import type {DbClient} from '../tickets/authorization';
import type {RouteCandidate} from './router';
import type {CandidateSnapshot} from './quick-reply';

export async function loadCandidates(client:DbClient,sessionId:string):Promise<RouteCandidate[]> {
 const rows=(await client.query(`select c.id,c.revision,c.mode,c.topic,t.id as ticket_id,t.revision as ticket_revision,t.status as ticket_status,t.ticket_no
 from public.conversations c left join public.tickets t on t.id=c.active_ticket_id
 where c.line_session_id=$1 and c.status in ('ACTIVE','WAITING') and c.conversation_type<>'SUPPORT'
 and (t.id is null or t.status not in ('CLOSED','RESOLVED','CANCELLED')) order by c.created_at,c.id`,[sessionId])).rows;
 return rows.map(row=>({conversationId:row.id,conversationRevision:row.revision,mode:row.mode,
  topicLabel:row.ticket_no??'เรื่องที่กำลังคุย',ticketId:row.ticket_id??null,ticketRevision:row.ticket_revision??null,ticketStatus:row.ticket_status??null}));
}
export function candidateSnapshot(candidates:RouteCandidate[]):CandidateSnapshot[] {
 return candidates.map(c=>({id:c.conversationId,revision:c.conversationRevision,ticketId:c.ticketId,ticketRevision:c.ticketRevision}));
}
