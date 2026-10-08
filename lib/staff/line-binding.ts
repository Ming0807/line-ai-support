import {randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,TicketError,type DbClient} from '../tickets/authorization';
import {readServerEnv} from '../config/env';
import {encryptValue,decryptValue,hashStaffLineUserId} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {BindingError,bindingChallengeInput,parseBindingCommand,type BindingStatus} from './line-binding-contracts';

const catalogLock='staff-line-binding:catalog';
type Options={pool?:Pool;encryptionKey?:string};
async function lockCatalog(c:DbClient,shared=false){
 await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='2s'");
 await c.query(shared?'select pg_advisory_xact_lock_shared(hashtextextended($1,0))':'select pg_advisory_xact_lock(hashtextextended($1,0))',[catalogLock]);
}
async function lockDelivery(c:DbClient,staffId:string){
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`delivery:STAFF:${staffId}`]);
}
async function status(c:DbClient,staffId:string):Promise<BindingStatus>{
 const bound=(await c.query('select staff_id from private.staff_line_identities where staff_id=$1 and active',[staffId])).rowCount===1;
 const pending=bound?null:(await c.query(`select expires_at from private.staff_binding_challenges
  where staff_id=$1 and consumed_at is null and invalidated_at is null and expires_at>clock_timestamp()
  order by created_at desc limit 1`,[staffId])).rows[0];
 return {bound,pending:!!pending,expiresAt:pending?.expires_at.toISOString()??null};
}
async function invalidate(c:DbClient,staffId:string){
 await c.query('update private.staff_binding_challenges set invalidated_at=clock_timestamp() where staff_id=$1 and invalidated_at is null',[staffId]);
}
export async function getBindingStatus(actorId:string,options:Pick<Options,'pool'>={}):Promise<BindingStatus>{
 return transaction(async c=>{await lockCatalog(c,true);await loadActor(c,actorId);return status(c,actorId);},options.pool);
}
export async function createBindingChallenge(actorId:string,input:unknown,options:Options={}){
 const parsed=bindingChallengeInput.safeParse(input);if(!parsed.success)throw new BindingError('INVALID_REQUEST');
 return transaction(async c=>{
  await lockCatalog(c);await lockDelivery(c,actorId);await loadActor(c,actorId);
  if((await status(c,actorId)).bound)throw new BindingError('ALREADY_BOUND');
  const key=options.encryptionKey??readServerEnv().encryptionKey;if(!key)throw new BindingError('UNAVAILABLE');
  const old=(await c.query(`select *,expires_at>clock_timestamp() as fresh from private.staff_binding_challenges
   where staff_id=$1 and request_id=$2 for update`,[actorId,parsed.data.requestId])).rows[0];
  if(old){
   if(!old.fresh||old.invalidated_at||old.consumed_at)throw new BindingError('CHALLENGE_EXPIRED');
   const command=`yru:staff:bind:${decryptValue(old.token_encrypted,key)}`;
   if(parseBindingCommand(command)===null)throw new BindingError('UNAVAILABLE');
   return {command,expiresAt:old.expires_at.toISOString() as string};
  }
  await invalidate(c,actorId);const token=randomBytes(32).toString('base64url');
  const row=(await c.query(`insert into private.staff_binding_challenges(token_hash,staff_id,request_id,token_encrypted,expires_at)
   values($1,$2,$3,$4,clock_timestamp()+interval '10 minutes') returning expires_at`,[hashOpaqueToken(token,key,'staff-binding'),actorId,parsed.data.requestId,encryptValue(token,key)])).rows[0];
  await c.query("insert into private.activities(actor_id,action) values($1,'STAFF_LINE_CHALLENGE_CREATED')",[actorId]);
  return {command:`yru:staff:bind:${token}`,expiresAt:row.expires_at.toISOString() as string};
 },options.pool);
}
export async function unlinkStaffLine(actorId:string,options:Pick<Options,'pool'>={}):Promise<BindingStatus>{
 return transaction(async c=>{
  await lockCatalog(c);await lockDelivery(c,actorId);await loadActor(c,actorId);
  const changed=await c.query('update private.staff_line_identities set active=false where staff_id=$1 and active',[actorId]);
  await invalidate(c,actorId);
  await c.query('update private.staff_action_tokens set consumed_at=clock_timestamp() where staff_id=$1 and consumed_at is null',[actorId]);
  if(changed.rowCount)await c.query("insert into private.activities(actor_id,action) values($1,'STAFF_LINE_UNLINKED')",[actorId]);
  return {bound:false,pending:false,expiresAt:null};
 },options.pool);
}
/** Called only by verified Staff inbox processing; caller owns its lease transaction. */
export async function consumeStaffBinding(c:DbClient,text:string,userId:string,key:string):Promise<string|null>{
 const token=parseBindingCommand(text);if(!token||!/^U[A-Za-z0-9]{1,127}$/.test(userId))return 'BINDING_INVALID';
 await lockCatalog(c);
 const hash=hashOpaqueToken(token,key,'staff-binding');
 const found=(await c.query('select staff_id from private.staff_binding_challenges where token_hash=$1',[hash])).rows[0];
 if(!found)return 'BINDING_INVALID';
 await lockDelivery(c,found.staff_id);
 try{await loadActor(c,found.staff_id);}catch(e){if(e instanceof TicketError)return 'BINDING_INVALID';throw e;}
 const row=(await c.query('select *,expires_at>clock_timestamp() as fresh from private.staff_binding_challenges where token_hash=$1 for update',[hash])).rows[0];
 if(!row||row.invalidated_at)return 'BINDING_INVALID';if(!row.fresh)return 'BINDING_EXPIRED';
 const userHash=hashStaffLineUserId(userId,key);
 const current=(await c.query('select * from private.staff_line_identities where staff_id=$1 for update',[found.staff_id])).rows[0];
 if(row.consumed_at)return row.consumed_user_hash===userHash&&current?.active&&current.user_hash===userHash?null:'BINDING_INVALID';
 if(current?.active)return 'BINDING_UNAVAILABLE';
 // Inactive identities still reserve their original owner; no automatic account transfer.
 if((await c.query('select staff_id from private.staff_line_identities where user_hash=$1 and staff_id<>$2',[userHash,found.staff_id])).rowCount)return 'BINDING_UNAVAILABLE';
 await c.query(`insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,active) values($1,$2,$3,true)
  on conflict(staff_id) do update set user_hash=excluded.user_hash,user_id_encrypted=excluded.user_id_encrypted,active=true`,[found.staff_id,userHash,encryptValue(userId,key)]);
 const used=await c.query(`update private.staff_binding_challenges set consumed_at=clock_timestamp(),consumed_user_hash=$2
  where token_hash=$1 and consumed_at is null and invalidated_at is null and expires_at>clock_timestamp()`,[hash,userHash]);
 if(used.rowCount!==1)throw new Error('STALE_BINDING_CHALLENGE');
 await c.query("insert into private.activities(actor_id,action) values($1,'STAFF_LINE_BOUND')",[found.staff_id]);
 return null;
}
