import {expect,it,vi} from 'vitest';
import {aggregateGaps,normalizeQuestion,mineKnowledgeGaps,type GapRow} from '../scripts/qa/knowledge-gap-miner';
const key='synthetic-gap-hmac-key-at-least-32-characters';
it('aggregates exact normalized questions without exposing raw questions or conversation IDs',()=>{
 const rows:GapRow[]=[
  {conversationId:'private-c1',answeredAt:'2026-10-25T10:00:00Z',question:'ค่าเทอม  ของนายทดสอบ  รหัส1234567890123'},
  {conversationId:'private-c2',answeredAt:'2026-10-25T11:00:00Z',question:'ค่าเทอม ของนายทดสอบ รหัส1234567890123'},
 ];
 const items=aggregateGaps(rows,key);
 expect(items).toHaveLength(1);expect(items[0]).toMatchObject({categoryHint:'TUITION',count:2,lastSeen:'2026-10-25T11:00:00Z'});
 expect(JSON.stringify(items)).not.toMatch(/นายทดสอบ|1234567890123|private-c/);
 expect(items[0].topicId).toMatch(/^[a-f0-9]{64}$/u);
});
it('does not merge questions which share the first300characters and changes identifiers with the key',()=>{
 const rows=[{conversationId:'x',answeredAt:'2026-10-25T10:00:00Z',question:'x'.repeat(300)+'a'},
 {conversationId:'x',answeredAt:'2026-10-25T10:00:00Z',question:'x'.repeat(300)+'b'}];
 const items=aggregateGaps(rows,key);expect(items).toHaveLength(2);
 expect(aggregateGaps(rows,'different-synthetic-secret-key-long-enough')[0].topicId).not.toBe(items[0].topicId);
});
it('skips absent/empty questions and normalizes whitespace without truncating',()=>{
 expect(aggregateGaps([{conversationId:'c',answeredAt:'2026-10-25T10:00:00Z',question:null},{conversationId:'c',answeredAt:'2026-10-25T10:00:00Z',question:'  '}],key)).toEqual([]);
 expect(normalizeQuestion('a\n\n  b\tc')).toBe('a b c');expect(normalizeQuestion('x'.repeat(400))).toHaveLength(400);
 expect(()=>aggregateGaps([], 'short')).toThrow();
});
it('uses one read-only connection, verifies SUPER_ADMIN and rolls back on denial before any message query',async()=>{
 const query=vi.fn<(text:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[];rowCount:number}>>(async()=>({rows:[],rowCount:0})),release=vi.fn(),pool={connect:async()=>({query,release})};
 await expect(mineKnowledgeGaps(pool,{actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hashKey:key})).rejects.toThrow('GAP_REPORT_FORBIDDEN');
 expect(query.mock.calls[0]?.[0]).toBe('begin read only');
 expect(query.mock.calls.some(call=>String(call[0]).includes('public.messages'))).toBe(false);
 expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');expect(release).toHaveBeenCalledOnce();
});
