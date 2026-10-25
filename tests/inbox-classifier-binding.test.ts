import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({classify:vi.fn(async()=>null),process:vi.fn(async()=>{}),transaction:vi.fn(async(fn:(client:unknown)=>Promise<unknown>)=>fn({}))}));
vi.mock('../lib/database/pool',()=>({transaction:mocks.transaction}));
vi.mock('../lib/queue/process-inbox',()=>({processInboxEvent:mocks.process}));
vi.mock('../lib/conversation/semantic-routing',()=>({classifyStudentInboxContext:mocks.classify}));
import {runInboxCycle} from '../lib/queue/run-inbox';
import type {Pool} from 'pg';
it('binds the classifier to each claimed Student lease and never to Staff',async()=>{
 const student={id:'student-owned-job',channel:'STUDENT',lease_token:'lease-a'},staff={id:'staff-owned-job',channel:'STAFF',lease_token:'lease-b'};
 const query=vi.fn().mockResolvedValueOnce({rows:[student]}).mockResolvedValueOnce({rows:[staff]});
 const classifier=vi.fn(),classifyForJob=vi.fn(()=>classifier);
 const result=await runInboxCycle({query} as unknown as Pool,'synthetic-key',{aiEnabled:true,classifyForJob});
 expect(result).toEqual({claimed:2,completed:2,failed:0});
 expect(classifyForJob).toHaveBeenCalledExactlyOnceWith(student);
 expect(mocks.classify).toHaveBeenCalledExactlyOnceWith(expect.anything(),student,'synthetic-key',classifier,expect.any(Function));
});
it('does not create a classifier when AI is disabled',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{id:'owned',channel:'STUDENT'}]}).mockResolvedValueOnce({rows:[]}),classifyForJob=vi.fn();
 await runInboxCycle({query} as unknown as Pool,'synthetic-key',{aiEnabled:false,classifyForJob});
 expect(classifyForJob).not.toHaveBeenCalled();
});
it('carries an unavailable observation only into Student processing while Staff still runs',async()=>{
 vi.clearAllMocks();
 const student={id:'student-owned-job',channel:'STUDENT',lease_token:'lease-a'},staff={id:'staff-owned-job',channel:'STAFF',lease_token:'lease-b'};
 const query=vi.fn().mockResolvedValueOnce({rows:[student]}).mockResolvedValueOnce({rows:[staff]});
 mocks.classify.mockImplementationOnce(async(...args:unknown[])=>{(args[4] as (reason:string)=>void)('TIMEOUT');return null;});
 const result=await runInboxCycle({query} as unknown as Pool,'synthetic-key',{aiEnabled:true,classify:vi.fn()});
 expect(result).toEqual({claimed:2,completed:2,failed:0});
 expect(mocks.process.mock.calls).toEqual([
  [expect.anything(),student,'synthetic-key',{aiEnabled:true,routingAdvice:undefined,routingUnavailable:true}],
  [expect.anything(),staff,'synthetic-key',{aiEnabled:true,routingAdvice:undefined,routingUnavailable:false}],
 ]);
});
