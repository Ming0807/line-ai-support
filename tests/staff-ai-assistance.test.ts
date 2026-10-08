import {expect,it} from 'vitest';
import {assistInputSchema,assistOutputSchema,projectAssistSource} from '@/lib/staff/ai-assistance-contracts';
it('accepts only an exact ticket revision, not caller-selected identity/history/tool context',()=>{
 expect(assistInputSchema.parse({revision:3})).toEqual({revision:3});
 for(const input of [{revision:3,staffId:'other'},{revision:3,conversationId:'other'},{revision:-1},{revision:3,messages:[]},{revision:3,sql:'select 1'}])expect(assistInputSchema.safeParse(input).success).toBe(false);
});
it('projects only minimized case text, marks truncation and keeps newest bounded history',()=>{
 const input={summary:'ทดสอบ',category:'IT_NETWORK',priority:'MEDIUM',line_session_id:'private-session',anonymous_code:'private-code',messages:Array.from({length:40},(_,i)=>({sender_type:'USER',content:`message${i}`,id:'private-message',staff_name:'private-name'})),departments:[{code:'IT',name:'ไอที',id:'private-department'}]};
 const projected=projectAssistSource(input);expect(projected.truncated).toBe(true);expect(projected.messages).toHaveLength(32);expect(projected.messages[0].content).toBe('message8');expect(projected.messages.at(-1)?.content).toBe('message39');expect(JSON.stringify(projected)).not.toContain('private-');
 const long=projectAssistSource({...input,messages:Array.from({length:32},()=>({sender_type:'USER',content:'ก'.repeat(10000)}))});expect(long.messages.reduce((n,m)=>n+m.content.length,0)).toBeLessThanOrEqual(10000);expect(long.truncated).toBe(true);
});
it('rejects malformed, unbounded or tool-bearing advice instead of trusting provider output',()=>{
 const output={ticketSummary:'สรุป',conversationSummary:'บทสนทนา',replyDraft:'คำตอบร่าง',suggestedDepartmentCode:'IT',suggestedPriority:'MEDIUM',reason:'เหตุผล',uncertainties:[]};
 expect(assistOutputSchema.parse(output)).toEqual(output);
 for(const bad of [{...output,sql:'drop table'},{...output,replyDraft:'x'.repeat(3501)},{...output,suggestedPriority:'URGENT'},{...output,suggestedDepartmentCode:'IT;drop table'}])expect(assistOutputSchema.safeParse(bad).success).toBe(false);
});
