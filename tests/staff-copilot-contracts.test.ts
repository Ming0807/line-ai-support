import {expect,it} from 'vitest';
import {staffCopilotAdviceSchema} from '../lib/staff/staff-copilot-contracts';
const ticketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft={ticketId,revision:3,status:'DRAFT',draftText:'ร่างคำตอบที่รอเจ้าหน้าที่ตรวจ',evidenceText:'หลักฐานที่ตรวจแล้ว',sources:[{title:'คู่มือ',academicYear:null,url:'https://yru.ac.th/guide',location:'หน้า2'}]};
it('accepts a complete draft bound to one case/revision, with verified source DTOs and full long text',()=>{
 expect(staffCopilotAdviceSchema.parse(draft)).toEqual(draft);
 expect(staffCopilotAdviceSchema.parse({...draft,draftText:'ก'.repeat(12000)}).draftText).toHaveLength(12000);
});
it('rejects unknown actor/source fields and incomplete or unsafe source references',()=>{
 for(const value of [{...draft,staffId:ticketId},{...draft,sources:[]},{...draft,sources:[{...draft.sources[0],url:'https://user:password@example.com'}]},{...draft,draftText:'ก'.repeat(12001)},{...draft,revision:-1}])expect(staffCopilotAdviceSchema.safeParse(value).success).toBe(false);
});
it('cannot present an unverified/missing answer as a sendable draft',()=>{
 expect(staffCopilotAdviceSchema.parse({ticketId,revision:0,status:'NO_USER_QUESTION',draftText:null,evidenceText:null,sources:[]})).toMatchObject({draftText:null});
 expect(staffCopilotAdviceSchema.parse({ticketId,revision:0,status:'NOT_VERIFIED',draftText:null,evidenceText:'ยังไม่มีหลักฐาน',sources:[]})).toMatchObject({draftText:null});
 expect(staffCopilotAdviceSchema.safeParse({...draft,status:'NOT_VERIFIED'}).success).toBe(false);
});
