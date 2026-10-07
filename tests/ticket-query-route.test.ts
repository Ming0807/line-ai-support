import {beforeEach,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({staff:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/tickets/api',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/tickets/api')>();
 return {...actual,apiStaffId:mocks.staff};
});
vi.mock('@/lib/tickets/reads',()=>({listTickets:mocks.list}));

import {GET} from '@/app/api/tickets/route';
import {parseTicketQuery,ticketFiltersSchema} from '@/types/tickets';
import type {TicketListResult} from '@/types/tickets';

const listResult:TicketListResult & {pagination:{page:number;pageSize:number;total:number;totalPages:number;hasNext:boolean;hasPrevious:boolean}}={
 tickets:[],departments:[],assignees:[],
 pagination:{page:2,pageSize:7,total:16,totalPages:3,hasNext:true,hasPrevious:true},
};
const request=(query='')=>new Request(`http://localhost:3000/api/tickets${query}`);
const privateHeaders=[
 ['cache-control','private, no-store, max-age=0'],
 ['vary','Cookie'],
 ['x-content-type-options','nosniff'],
] as const;
function expectPrivateHeaders(response:Response){
 for(const [name,value] of privateHeaders)expect(response.headers.get(name)).toBe(value);
}

beforeEach(()=>{
 vi.resetAllMocks();
 mocks.staff.mockResolvedValue('staff-id');
 mocks.list.mockResolvedValue(listResult);
});

it('parses a bounded literal query and canonical pages while preserving existing selectors',()=>{
 const query=parseTicketQuery(new URLSearchParams('q=%20%E0%B8%9B%E0%B8%8F%E0%B8%B4%E0%B8%97%E0%B8%B4%E0%B8%99%20&page=2&pageSize=7&status=NEW&from=2026-10-01&to=2026-10-07'));
 expect(query).toEqual({q:'ปฏิทิน',page:2,pageSize:7,status:'NEW',from:'2026-10-01',to:'2026-10-07'});
 expect(parseTicketQuery(new URLSearchParams('q=%20%20'))).toMatchObject({q:undefined,page:1,pageSize:100});
 expect(parseTicketQuery(new URLSearchParams(`q=${'x'.repeat(200)}`))).toMatchObject({q:'x'.repeat(200),page:1,pageSize:100});
});

it('accepts integer service page values and rejects non-string URL page values',()=>{
 expect(ticketFiltersSchema.parse({page:2,pageSize:7})).toMatchObject({page:2,pageSize:7});
 for(const value of [true,{},[],null]){
  expect(()=>ticketFiltersSchema.parse({page:value})).toThrow();
  expect(()=>ticketFiltersSchema.parse({pageSize:value})).toThrow();
 }
});

it('rejects unknown, duplicate, malformed, and out-of-range query values',()=>{
 const invalid=[
  'sql=select', 'q=a&q=b', 'page=1&page=2', 'pageSize=10&pageSize=20',
  'q='+encodeURIComponent('x'.repeat(201)), 'q='+encodeURIComponent('x\u0000y'),
  'q='+encodeURIComponent('x\u0085y'), 'q='+encodeURIComponent('x\u009fy'),
  'page=0','page=10001','page=01','page=2.5','page=+2','pageSize=0',
  'pageSize=101','pageSize=01','pageSize=-1','from=2026-02-30','from=2026-10-08&to=2026-10-07',
 ];
 for(const query of invalid)expect(()=>parseTicketQuery(new URLSearchParams(query))).toThrow();
});

it('treats SQL-looking and wildcard-shaped text as bounded literal query data',()=>{
 const literal="%' OR 1=1 -- _ !";
 expect(parseTicketQuery(new URLSearchParams(`q=${encodeURIComponent(literal)}`))).toMatchObject({q:literal,page:1,pageSize:100});
});

it('authenticates before reading the URL and returns private headers on 401',async()=>{
 const poisoned=request();
 Object.defineProperty(poisoned,'url',{get(){throw new Error('URL_READ_BEFORE_AUTH');}});
 mocks.staff.mockResolvedValue(null);
 const response=await GET(poisoned);
 expect(response.status).toBe(401);
 expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});
 expectPrivateHeaders(response);
 expect(mocks.list).not.toHaveBeenCalled();
});

it('keeps the direct list response shape and sends parsed search/page selectors to the service',async()=>{
 const response=await GET(request('?q=%20%E0%B8%AB%E0%B8%AD%E0%B8%9E%E0%B8%B1%E0%B8%81%20&page=2&pageSize=7&status=NEW'));
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual(listResult);
 expect(mocks.list).toHaveBeenCalledWith('staff-id',{q:'หอพัก',page:2,pageSize:7,status:'NEW'});
 expectPrivateHeaders(response);
});

it('rejects invalid and duplicate selectors with a fixed 400 before listing',async()=>{
 for(const query of ['?unknown=1','?page=1&page=2','?q=private&q=other','?from=2026-02-30','?page=10001','?q='+encodeURIComponent('x'.repeat(201))]){
  const response=await GET(request(query));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'INVALID_REQUEST'});
  expectPrivateHeaders(response);
 }
 expect(mocks.list).not.toHaveBeenCalled();
});

it('maps service failures to a safe 503 without leaking details and keeps private headers',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 mocks.list.mockRejectedValue(new Error('private summary, credential, and stack detail'));
 const response=await GET(request());
 expect(response.status).toBe(503);
 const body=await response.json();
 expect(body).toEqual({error:'INTERNAL_ERROR'});
 expectPrivateHeaders(response);
 expect(log).toHaveBeenCalledWith('TICKET_API_FAILED',{code:'INTERNAL_ERROR'});
 expect(JSON.stringify(body)).not.toContain('private summary');
 log.mockRestore();
});
