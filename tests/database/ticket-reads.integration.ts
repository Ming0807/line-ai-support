import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {listTickets} from '../../lib/tickets/reads';
import {getDatabasePool} from '../../lib/database/pool';
import type {TicketFilters} from '../../types/tickets';

const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
// Never let the RED pre-seam implementation use a remote environment database.
process.env.DATABASE_URL=localUrl;
const pool=new Pool({connectionString:localUrl,max:3});
after(async()=>{await pool.end();await getDatabasePool().end();});

async function fixture(run:(f:{a:string;b:string;staff:string;sensitive:string;admin:string;session:string;marker:string;seed:(options?:{department?:string;sensitivity?:string;title?:string;createdAt?:string;category?:string})=>Promise<string>;read:(actor:string,filters?:TicketFilters)=>ReturnType<typeof listTickets>})=>Promise<void>){
 const letters=Array.from(randomBytes(12),n=>String.fromCharCode(65+n%26)).join(''),marker='TKTREAD_'+letters,actors=[randomUUID(),randomUUID(),randomUUID()],departments=[randomUUID(),randomUUID()],session=randomUUID();
 try{
  await pool.query("insert into public.departments(id,code,name_th,name_en) values($1,$3,'ฝ่ายอ่านทดสอบเอ','Read fixture A'),($2,$4,'ฝ่ายอ่านทดสอบบี','Read fixture B')",[...departments,marker+'_A',marker+'_B']);
  for(const actor of actors)await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query(`insert into public.staff_profiles(id,display_name,department_id,role,can_view_sensitive) values($1,'Read fixture staff',$4,'STAFF',false),($2,'Read fixture sensitive',$4,'STAFF',true),($3,'Read fixture admin',null,'ADMIN',false)`,[...actors,departments[0]]);
  await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[actors[2],departments[0]]);
  await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,marker]);
  const seed=async(options:{department?:string;sensitivity?:string;title?:string;createdAt?:string;category?:string}={})=>{
   const conversation=randomUUID(),id=randomUUID();await pool.query("insert into public.conversations(id,line_session_id,conversation_type,mode,status) values($1,$2,'TICKET','HUMAN','ACTIVE')",[conversation,session]);
   await pool.query(`insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'HUMAN','WAITING_STAFF',$7,$8,$8)`,[id,session,conversation,options.department??departments[0],options.title??'คำถามทดสอบ',options.category??'GENERAL',options.sensitivity??'GENERAL',options.createdAt??'2026-10-07T00:00:00.000Z']);return id;
  };
  await run({a:departments[0],b:departments[1],staff:actors[0],sensitive:actors[1],admin:actors[2],session,marker,seed,read:(actor,filters={})=>listTickets(actor,filters,{pool})});
 }finally{
  await pool.query('delete from public.tickets where line_session_id=$1',[session]);
  await pool.query('delete from public.conversations where line_session_id=$1',[session]);
  await pool.query('delete from public.line_sessions where id=$1 and anonymous_code=$2',[session,marker]);
  await pool.query('delete from public.staff_department_grants where staff_id=any($1::uuid[])',[actors]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[actors]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[actors]);
  await pool.query('delete from public.departments where id=any($1::uuid[]) and code like $2',[departments,marker+'%']);
 }
}

test('100+ rows remain reachable with exact scoped totals and stable same-time ordering',()=>fixture(async f=>{
 const ids:string[]=[];for(let i=0;i<105;i++)ids.push(await f.seed());ids.sort();
 const first=await f.read(f.staff),second=await f.read(f.staff,{page:2}),far=await f.read(f.staff,{page:999});
 assert.deepEqual(first.tickets.map(t=>t.id),ids.slice(0,100));assert.deepEqual(second.tickets.map(t=>t.id),ids.slice(100));assert.equal(far.tickets.length,0);
 assert.deepEqual(first.pagination,{page:1,pageSize:100,total:105,totalPages:2,hasNext:true,hasPrevious:false});
 assert.deepEqual(second.pagination,{page:2,pageSize:100,total:105,totalPages:2,hasNext:false,hasPrevious:true});assert.equal(far.pagination?.total,105);
 assert.equal(new Set([...first.tickets,...second.tickets].map(t=>t.id)).size,105);
}));
test('literal Thai/case/wildcard/injection-shaped searches only match authorized safe fields',()=>fixture(async f=>{
 const literal=await f.seed({title:'ค่าใช้จ่าย 100%_! '+f.marker}),thai=await f.seed({title:'ปัญหา WiFi เชื่อมต่อ'});
 await f.seed({title:'ค่าใช้จ่าย 100XYZQ '+f.marker});
 assert.deepEqual((await f.read(f.staff,{q:'100%_!'})).tickets.map(t=>t.id),[literal]);
 assert.deepEqual((await f.read(f.staff,{q:'wifi'})).tickets.map(t=>t.id),[thai]);
 assert.equal((await f.read(f.staff,{q:'ปัญหา'})).pagination?.total,1);
 assert.equal((await f.read(f.staff,{q:f.marker.toLowerCase()})).pagination?.total,3);
 assert.equal((await f.read(f.staff,{q:"%' OR true --"})).pagination?.total,0);
 const first=await f.read(f.staff,{pageSize:1});assert.equal((await f.read(f.staff,{q:first.tickets[0].ticket_no})).pagination?.total,1);
}));
test('counts and pages enforce department/sensitivity and fresh explicit ADMIN grants',()=>fixture(async f=>{
 const general=await f.seed(),sensitive=await f.seed({sensitivity:'SENSITIVE'});await f.seed({department:f.b});await f.seed({sensitivity:'RESTRICTED'});
 assert.deepEqual((await f.read(f.staff)).tickets.map(t=>t.id),[general]);assert.equal((await f.read(f.staff,{q:f.marker,pageSize:1})).pagination?.total,1);
 const privileged=await f.read(f.sensitive);assert.deepEqual(new Set(privileged.tickets.map(t=>t.id)),new Set([general,sensitive]));assert.equal(privileged.pagination?.total,2);
 assert.equal((await f.read(f.admin)).pagination?.total,1);await pool.query('delete from public.staff_department_grants where staff_id=$1',[f.admin]);
 assert.equal((await f.read(f.admin)).pagination?.total,0);assert.equal((await f.read(f.staff,{department:f.b})).pagination?.total,0);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await assert.rejects(f.read(f.staff),{code:'NOT_FOUND'});
}));
test('Bangkok date bounds and all filters precede matching totals',()=>fixture(async f=>{
 await f.seed({createdAt:'2026-10-06T16:59:59Z'});const start=await f.seed({createdAt:'2026-10-06T17:00:00Z'}),end=await f.seed({createdAt:'2026-10-07T16:59:59Z'});await f.seed({createdAt:'2026-10-07T17:00:00Z'});
 const result=await f.read(f.staff,{from:'2026-10-07',to:'2026-10-07',pageSize:1});assert.equal(result.pagination?.total,2);assert.deepEqual(result.tickets.map(t=>t.id),[end]);
 assert.deepEqual((await f.read(f.staff,{from:'2026-10-07',to:'2026-10-07',pageSize:1,page:2})).tickets.map(t=>t.id),[start]);
 assert.equal((await f.read(f.staff,{status:'CLOSED'})).pagination?.total,0);
}));
test('empty/unknown actor reads do not invent totals or bypass authorization',()=>fixture(async f=>{
 const empty=await f.read(f.staff,{page:2,pageSize:10});assert.deepEqual(empty.tickets,[]);assert.deepEqual(empty.pagination,{page:2,pageSize:10,total:0,totalPages:0,hasNext:false,hasPrevious:true});
 await assert.rejects(f.read(randomUUID()),{code:'NOT_FOUND'});
 assert.equal((await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,0);
}));
