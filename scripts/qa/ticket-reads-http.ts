import 'dotenv/config';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createServerClient} from '@supabase/ssr';

class QaFailure extends Error{constructor(readonly code:string){super(code);}}
function check(value:unknown,code:string):asserts value{if(!value)throw new QaFailure(code);}
const root=process.cwd(),output=resolve('.superpowers/staging/knowledge-backend-qa'),base='http://127.0.0.1:3011',checks:string[]=[];
let pool:Pool|undefined,session:string|undefined,marker:string|undefined,stage='configuration';
async function login(account:{id:string;email:string;password:string}){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;check(url&&key,'AUTH_CONFIGURATION_REQUIRED');
 const jar=new Map<string,string>(),client=createServerClient(url,key,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:entries=>{for(const entry of entries)jar.set(entry.name,entry.value);}}});
 const result=await client.auth.signInWithPassword({email:account.email,password:account.password});check(!result.error&&result.data.user?.id===account.id,'ACTUAL_AUTH_FAILED');
 return [...jar].map(([name,value])=>`${name}=${encodeURIComponent(value)}`).join('; ');
}
async function call(query:string,status:number,cookie=''){
 const response=await fetch(base+'/api/tickets'+query,{headers:{cookie}});check(response.status===status,'HTTP_'+status+'_EXPECTED');
 const varied=(response.headers.get('vary')??'').split(',').map(value=>value.trim().toLowerCase());
 check(response.headers.get('cache-control')==='private, no-store, max-age=0'&&varied.includes('cookie')&&response.headers.get('x-content-type-options')==='nosniff','PRIVATE_HEADERS_REQUIRED');return response.json();
}
try{
 check(basename(dirname(root))==='backend-knowledge-api-qa','OWNED_QA_WORKTREE_REQUIRED');
 const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8')),target=new URL(runtime.connectionString);
 check(['postgres:','postgresql:'].includes(target.protocol)&&target.hostname==='127.0.0.1'&&target.port==='54422'&&/^\/yru_publication_ui_qa_[a-f0-9]{12}$/.test(target.pathname)&&target.pathname.slice(1)===runtime.database,'OWNED_LOCAL_DATABASE_REQUIRED');
 const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));check(credentials.projectRef===process.env.DEV_SUPABASE_PROJECT_REF&&credentials.accounts.length===3,'ACTUAL_THREE_ROLES_REQUIRED');
 const admin=credentials.accounts.find((a:{role:string})=>a.role==='SUPER_ADMIN'),staff=credentials.accounts.filter((a:{role:string})=>a.role==='STAFF');check(admin&&staff.length===2,'ACTUAL_ROLES_REQUIRED');
 await call('?unknown=1',401);const cookies=await Promise.all([admin,...staff].map(login));
 for(const cookie of cookies)await call('?page=1&page=2',400,cookie);checks.push('actual_three_role_auth_anonymous_and_duplicate_private_headers');
 pool=new Pool({connectionString:runtime.connectionString,max:3,application_name:'ticket-http-'+randomUUID()});
 const profiles=(await pool.query('select id,department_id,role from public.staff_profiles where id=any($1::uuid[]) and active',[[admin.id,...staff.map((a:{id:string})=>a.id)]])).rows;
 const a=profiles.find(p=>p.id===staff[0].id),b=profiles.find(p=>p.id===staff[1].id);check(profiles.length===3&&a?.department_id&&b?.department_id&&a.department_id!==b.department_id,'QA_MIRROR_DISTINCT_SCOPES_REQUIRED');
 session=randomUUID();marker='Ticket_HTTP_'+randomUUID();await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,marker]);
 const ids:string[]=[];stage='synthetic_fixture';
 for(let i=0;i<105;i++){const id=randomUUID(),conversation=randomUUID();ids.push(id);await pool.query("insert into public.conversations(id,line_session_id,conversation_type,mode,status) values($1,$2,'TICKET','HUMAN','ACTIVE')",[conversation,session]);await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,mode,status,created_at,updated_at) values($1,$2,$3,$4,$5,'HUMAN','WAITING_STAFF','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z')",[id,session,conversation,a.department_id,i===0?'Synthetic 100%_!':'Synthetic ticket']);}
 stage='compiled_paging';const literalId=ids[0],query='?q='+encodeURIComponent(marker),first=await call(query,200,cookies[0]),second=await call(query+'&page=2',200,cookies[0]);ids.sort();
 check(first.tickets.length===100&&second.tickets.length===5&&first.pagination.total===105&&first.pagination.hasNext&&second.pagination.total===105&&!second.pagination.hasNext,'PAGING_TOTAL_REQUIRED');
 check(JSON.stringify([...first.tickets,...second.tickets].map((t:{id:string})=>t.id))===JSON.stringify(ids),'STABLE_ORDER_REQUIRED');checks.push('compiled_105_rows_same_snapshot_totals_stable_pages');
 check(!Object.hasOwn(first.tickets[0],'line_session_id')&&!Object.hasOwn(first.tickets[0],'line_user_id'),'TECHNICAL_IDENTITY_EXPOSED');checks.push('safe_list_dto_no_technical_line_identity');
 const own=await call(query+'&pageSize=1',200,cookies[1]),other=await call(query,200,cookies[2]);check(own.pagination.total===105&&own.tickets.length===1&&other.pagination.total===0&&other.tickets.length===0,'SCOPED_TOTAL_REQUIRED');checks.push('actual_staff_department_scoped_total_and_rows');
 const literal=await call('?q='+encodeURIComponent('100%_!'),200,cookies[1]);check(literal.tickets.length===1&&literal.tickets[0].id===literalId,'LITERAL_SEARCH_REQUIRED');check(literal.tickets[0].problem_summary==='Synthetic 100%_!','EXACT_LITERAL_REQUIRED');checks.push('literal_wildcards_escape_and_exact_text');
 const far=await call(query+'&page=999',200,cookies[0]),zero=await call('?q='+encodeURIComponent(marker+'missing'),200,cookies[0]);check(far.tickets.length===0&&far.pagination.total===105&&zero.pagination.total===0,'EMPTY_PAGE_TOTAL_REQUIRED');checks.push('out_of_range_and_zero_results_truthful');
 for(const invalid of ['?page=01','?page=10001','?q=a&q=b','?unknown=1','?q='+encodeURIComponent('x'.repeat(201)),'?q='+encodeURIComponent('\u0085')])await call(invalid,400,cookies[0]);checks.push('compiled_bounded_strict_query_and_private_errors');
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'ticket-reads-http-result.json'),JSON.stringify({status:'PASS',checks,environment:'compiled_owned_localhost3011',authentication:'actual_development_three_roles_via_ssr',businessDatabase:'owned_isolated_qa',remoteBusinessWrites:0,providerCalls:0,lineCalls:0},null,2));console.log(JSON.stringify({status:'PASS',checks:checks.length}));
}catch(error){console.error(JSON.stringify({status:'FAIL',stage,code:error instanceof QaFailure?error.code:'INTERNAL_ERROR'}));process.exitCode=1;}
finally{try{if(pool&&session&&marker){await pool.query('delete from public.tickets where line_session_id=$1',[session]);await pool.query('delete from public.conversations where line_session_id=$1',[session]);await pool.query('delete from public.line_sessions where id=$1 and anonymous_code=$2',[session,marker]);}}catch{console.error(JSON.stringify({status:'FAIL',stage:'owned_fixture_cleanup',code:'CLEANUP_REQUIRED'}));process.exitCode=1;}await pool?.end();}
