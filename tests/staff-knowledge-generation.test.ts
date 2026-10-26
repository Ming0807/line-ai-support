import {afterEach,expect,it,vi} from 'vitest';
import {Pool,Client} from 'pg';
import {createStaffKnowledgeAssistance} from '../lib/staff/knowledge-assistance';
import {withStaffAssistanceSnapshot} from '../lib/staff/ai-assistance-snapshot';
import {generate as gateway} from '../lib/ai/gateway';
vi.mock('../lib/staff/ai-assistance-snapshot',()=>({withStaffAssistanceSnapshot:vi.fn()}));
vi.mock('../lib/ai/gateway',()=>({generate:vi.fn()}));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('uses the supplied server-only generation boundary with the bound ticket and cancellation signal',async()=>{
 vi.stubEnv('YRU_AI_ENABLED','true');
 const pool=new Pool();
 const current={source:{summary:'Synthetic',category:'IT',priority:'NORMAL',messages:[],departments:[],truncated:false},serialized:'{}',digest:'stable',revision:0,
  knowledge:{jobId:id,sessionId:id,conversationId:id,messageId:id,revision:0,question:'คำถามทดสอบ',history:[]}};
 vi.mocked(withStaffAssistanceSnapshot).mockImplementation(async(...args)=>{
  const client=Object.assign(new Client(),{release:vi.fn()});
  return args[4](client,current);
 });
 const generate=vi.fn(async()=>({output:null,toolCalls:[],providerId:id,modelId:id,fallbackUsed:false}));
 try{
  const result=await createStaffKnowledgeAssistance(id,id,{revision:0},{pool,key:'synthetic-key',generate});
  expect(result.status).toBe('NOT_VERIFIED');expect(generate).toHaveBeenCalledOnce();
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({taskType:'KNOWLEDGE_SCOPE',ticketId:id,signal:expect.any(AbortSignal)}));
  expect(gateway).not.toHaveBeenCalled();
 }finally{await pool.end();}
});
