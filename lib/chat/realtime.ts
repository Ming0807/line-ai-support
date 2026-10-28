import type {Pool} from 'pg';

let warned=false;
/** Best-effort hint only. Transcript writes/delivery must survive Realtime outages. */
export async function flushInboxInvalidations(pool:Pool):Promise<void>{
 try{await pool.query('select private.flush_inbox_invalidations()');warned=false;}
 catch{if(!warned){warned=true;console.warn('INBOX_REALTIME_HINT_UNAVAILABLE');}}
}
