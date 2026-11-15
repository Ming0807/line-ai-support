import type {Pool} from 'pg';
import {z} from 'zod';

// Imported by the MEDIA worker (plain Node, no react-server condition), so this module must not
// import 'server-only'. It reads and writes status only; no keys, names, recipients or Storage.
const reconcileOptionsSchema=z.strictObject({
 graceSeconds:z.number().int().min(60).max(86_400).default(600),limit:z.number().int().min(1).max(1000).default(100),
});
/**
 * Retires drafts whose upload lease expired more than `graceSeconds` ago (a crashed or abandoned
 * uploader). An exhausted third attempt becomes ATTEMPT_LIMIT, any other becomes UPLOAD_INTERRUPTED.
 * Status recovery only: no Storage call, no object deletion, no lease extension. The grace period
 * leaves a recently expired lease reclaimable by the same request. SKIP LOCKED keeps it from
 * blocking a concurrent reservation or finalization of the same row.
 */
export async function reconcileStaffOutboundUploads(pool:Pool,options:{graceSeconds?:number;limit?:number}={}):Promise<{interrupted:string[];attemptLimit:string[]}>{
 const parsed=reconcileOptionsSchema.safeParse(options);if(!parsed.success)throw new Error('INVALID_RECONCILE_OPTIONS');
 const {graceSeconds,limit}=parsed.data;
 const rows=(await pool.query(`with stale as(
   select id from private.staff_outbound_attachments
   where status='UPLOADING' and lease_until<clock_timestamp()-make_interval(secs=>$1)
   order by lease_until limit $2 for update skip locked)
  update private.staff_outbound_attachments a set status='FAILED',
   failure_code=case when a.attempts>=3 then 'ATTEMPT_LIMIT' else 'UPLOAD_INTERRUPTED' end,lease_token=null,lease_until=null
  from stale where a.id=stale.id returning a.id,a.failure_code`,[graceSeconds,limit])).rows as {id:string;failure_code:string}[];
 return {
  interrupted:rows.filter(row=>row.failure_code==='UPLOAD_INTERRUPTED').map(row=>row.id),
  attemptLimit:rows.filter(row=>row.failure_code==='ATTEMPT_LIMIT').map(row=>row.id),
 };
}
