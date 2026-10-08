import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),list:vi.fn(),detail:vi.fn(),rules:vi.fn(),similar:vi.fn(),change:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/tickets/api',()=>({apiStaffId:m.staff}));
vi.mock('@/lib/incidents/reads',async importOriginal=>({...await importOriginal<typeof import('@/lib/incidents/reads')>(),listIncidents:m.list,getIncident:m.detail,getIncidentRules:m.rules,getSimilarIssues:m.similar}));
vi.mock('@/lib/incidents/actions',()=>({changeIncidentStatus:m.change,updateIncidentRules:m.update}));
import {incidentRead,incidentMutation} from '@/lib/incidents/api';
import {IncidentError} from '@/lib/incidents/contracts';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue('actor');m.list.mockResolvedValue({items:[]});m.rules.mockResolvedValue({rules:{}});m.change.mockResolvedValue({revision:1});});
it('authenticates before any incident query parsing and uses private headers',async()=>{
 m.staff.mockResolvedValue(null);const r=new Request('http://localhost');Object.defineProperty(r,'url',{get(){throw Error('must not parse');}});
 const response=await incidentRead(r,'list');expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');expect(m.list).not.toHaveBeenCalled();
});
it('accepts bounded selectors and rejects duplicate/unknown incident queries',async()=>{
 expect((await incidentRead(new Request('http://localhost?page=2&pageSize=10&status=DETECTED'),'list')).status).toBe(200);
 expect(m.list).toHaveBeenCalledWith('actor',expect.objectContaining({page:2,pageSize:10,status:'DETECTED'}));
 for(const q of ['unknown=1','page=1&page=2','page=0','severity=LOW','department=bad'])expect((await incidentRead(new Request('http://localhost?'+q),'list')).status).toBe(400);
});
it('guards same-origin mutation, body size/type and safe errors',async()=>{
 expect((await incidentMutation(new Request('http://localhost/api/incidents/rules',{method:'PUT'}),'rules')).status).toBe(403);
 expect((await incidentMutation(new Request('http://localhost/api/incidents/rules',{method:'PUT',headers:{origin:'https://foreign.example'}}),'rules')).status).toBe(403);expect(m.staff).not.toHaveBeenCalled();
 for(const [error,status,code] of [[new IncidentError('FORBIDDEN'),403,'FORBIDDEN'],[new IncidentError('CONFLICT'),409,'CONFLICT'],[Error('private credentials'),503,'UNAVAILABLE']] as const){
  m.rules.mockRejectedValue(error);const response=await incidentRead(new Request('http://localhost'),'rules');expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
 }
});
it('rejects oversized, malformed, invalid UTF-8 and unsupported mutation bodies before the service',async()=>{
 const request=(body:BodyInit,contentType='application/json')=>new Request('http://localhost:3000/api/incidents/rules',{method:'PUT',headers:{origin:'http://localhost:3000',host:'localhost:3000','content-type':contentType},body});
 for(const [r,status] of [[request('{'),400],[request('x'.repeat(8193)),413],[request(new Uint8Array([0xff])),400],[request('{}','text/plain'),400]] as const){
  const response=await incidentMutation(r,'rules');expect(response.status).toBe(status);expect(await response.json()).toEqual({error:'INVALID_REQUEST'});
 }
 expect(m.update).not.toHaveBeenCalled();
});
