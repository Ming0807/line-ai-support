import {expect,it} from 'vitest';
import {parseActivityQuery,parseLogQuery,projectActivity,projectLog,makePagination,operationsEnvelopeSchema} from '../lib/operations/contracts';

const now=new Date('2026-10-07T18:00:00Z');
it('uses Bangkok civil days and derives bounded seven-day windows',()=>{
 expect(parseActivityQuery(new URLSearchParams(),now)).toEqual({page:1,pageSize:25,from:'2026-10-02',to:'2026-10-08'});
 expect(parseLogQuery(new URLSearchParams('from=2024-02-27'),now)).toMatchObject({from:'2024-02-27',to:'2024-03-04'});
 expect(parseLogQuery(new URLSearchParams('to=2024-03-04'),now)).toMatchObject({from:'2024-02-27',to:'2024-03-04'});
 expect(parseActivityQuery(new URLSearchParams('q=%20สวัสดี%20&action=REOPEN&page=2&pageSize=100'),now)).toMatchObject({q:'สวัสดี',action:'REOPEN',page:2,pageSize:100});
});
it.each(['sql=1','q=a&q=b','page=01','page=0','page=10001','pageSize=101','from=2026-02-30','from=2026-10-08&to=2026-10-07','from=2026-01-01&to=2026-04-01','q=%00','q=%C2%85','action=secret'])('rejects malformed, duplicate, unknown or excessive activity query %s',query=>{
 expect(()=>parseActivityQuery(new URLSearchParams(query),now)).toThrow();
});
it.each(['component=webhook-ingress','severity=DEBUG','code=private-token','action=CREATE','pageSize=','to=2026-13-01'])('rejects unsupported log query %s',query=>expect(()=>parseLogQuery(new URLSearchParams(query),now)).toThrow());
it('projects private audit rows through fixed vocabulary without metadata or unknown action echo',()=>{
 const row={id:'9fe2233d-05b8-4e91-8b26-fc2773f96fe5',created_at:new Date('2026-10-08T01:00:00Z'),action:'STAFF_REPLIED',actor_name:'เจ้าหน้าที่',ticket_code:'TK-2026-0001',department_label:'ฝ่ายบริการ',metadata:{token:'never-public'},actor_id:'never-public'};
 expect(projectActivity(row)).toMatchObject({action:'REPLY',occurredAt:'2026-10-08T01:00:00.000Z',actorDisplayName:'เจ้าหน้าที่',ticketCode:'TK-2026-0001'});
 expect(Object.keys(projectActivity(row)).sort()).toEqual(['id','occurredAt','action','actionLabel','actorDisplayName','ticketCode','departmentLabel','summary'].sort());
 expect(JSON.stringify(projectActivity({...row,action:'credential-never-public'}))).not.toContain('never-public');
 expect(projectActivity({...row,action:'credential-never-public'}).action).toBe('OTHER');
});
it('projects transport observations and suppresses raw unknown LINE codes/request IDs',()=>{
 const row={id:'line:42',created_at:new Date('2026-10-08T01:00:00Z'),component:'line-delivery',error_code:'secret-never-public',http_status:429,accepted:false,request_id:'secret-never-public'};
 const result=projectLog(row);expect(result).toMatchObject({code:'LINE_DELIVERY_FAILED',severity:'WARN',httpStatus:429,correlationId:null});
 expect(JSON.stringify(result)).not.toContain('secret-never-public');
 expect(projectLog({...row,accepted:true,http_status:409})).toMatchObject({code:'LINE_DELIVERED',severity:'INFO',httpStatus:409});
 expect(projectLog({...row,component:'ai-gateway',error_code:'AUTH_ERROR',http_status:401})).toMatchObject({code:'AUTH_ERROR',severity:'ERROR'});
 expect(()=>projectLog({...row,http_status:0})).toThrow();
 expect(projectLog({...row,error_code:'LINE_DELIVERED',accepted:false})).toMatchObject({code:'LINE_DELIVERY_FAILED',severity:'WARN'});
});
it.each(['AI_PROVIDERS_REORDERED','AI_MODELS_REORDERED','AI_PROVIDER_COST_MODE_CHANGED','AI_MODEL_TESTED','AI_MODEL_PRICING_CHECKED','AI_PROVIDER_QUOTA_CHECKED'])('groups actual provider audit action %s without metadata',action=>expect(projectActivity({id:'9fe2233d-05b8-4e91-8b26-fc2773f96fe5',created_at:new Date(),action}).action).toBe('PROVIDER'));
it('keeps zero and out-of-range pagination truthful and validates the full public envelope',()=>{
 expect(makePagination(4,25,3)).toEqual({page:4,pageSize:25,total:3,totalPages:1,hasNext:false,hasPrevious:true});
 expect(makePagination(1,25,0).totalPages).toBe(0);
 expect(()=>makePagination(1,25,Number.NaN)).toThrow();
 const body={items:[],pagination:makePagination(1,25,0),window:{from:'2026-10-02',to:'2026-10-08',timeZone:'Asia/Bangkok'}};
 expect(operationsEnvelopeSchema('activities').parse(body)).toEqual(body);
 expect(()=>operationsEnvelopeSchema('activities').parse({...body,pagination:{...body.pagination,totalPages:3}})).toThrow();
 expect(()=>operationsEnvelopeSchema('logs').parse({...body,token:'never-public'})).toThrow();
});
