import {expect,it} from 'vitest';
import {supportProposalSchema,projectSupportInput,interpretSupportProposal} from '@/lib/ai/support-contracts';
const departments=[{code:'IT',name:'เทคโนโลยีสารสนเทศ'},{code:'REGISTRAR',name:'งานทะเบียน'}];
const input=()=>projectSupportInput({question:'มือถือ Android ขึ้นว่า authentication failed',history:[{role:'user',content:'Wi-Fi ต่อไม่ได้ครับ'},{role:'assistant',content:'PRIVATE_ASSISTANT_RULE'}],deliveredGuidance:false},departments);
const proposal=(changes:Record<string,unknown>={})=>({intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium',needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.95,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'DEVICE',source:'U0',quote:'มือถือ Android'},{field:'ERROR',source:'U0',quote:'authentication failed'}],...changes});
it('projects bounded actual USER sources and the public active directory without backend or assistant identities',()=>{
 const snapshot={question:'ปัญหา',history:[{role:'user',content:'ก'.repeat(4000)},{role:'assistant',content:'PRIVATE_ASSISTANT_RULE'}],deliveredGuidance:true,sessionId:'PRIVATE_SESSION',lineId:'PRIVATE_LINE'};
 const directory=[{code:'IT',name:'ไอที',id:'PRIVATE_DEPARTMENT'}];const projected=projectSupportInput(snapshot,directory);
 expect(projected.sources.map(s=>s.code)).toEqual(['U0','U1']);expect(projected.sources[1].text.length).toBeLessThanOrEqual(1000);
 expect(JSON.stringify(projected)).not.toContain('PRIVATE_');expect(projected.deliveredGuidance).toBe(true);
});
it('rejects unknown proposal fields, uncontrolled facts and inconsistent support flags',()=>{
 for(const changes of [{sql:'select 1'},{intent:'EXECUTE_SQL'},{facts:[{field:'ENROLLMENT',source:'U0',quote:'x'}]},{missingContext:'STUDENT_ID'},{intent:'INFORMATION',needsTicket:true},{intent:'SOLVED',needsTicket:true},{confidence:Infinity},{subcategory:'invented arbitrary detail'}])expect(supportProposalSchema.safeParse(proposal(changes)).success).toBe(false);
});
it('keeps the source-selected original Wi-Fi problem and literal device/error facts in a continuation search',()=>{
 const result=interpretSupportProposal(proposal(),input());expect(result).toMatchObject({intent:'TROUBLESHOOT',category:'IT_SUPPORT',departmentCode:'IT',priority:'MEDIUM',severity:'NORMAL',sensitiveLevel:'GENERAL',problemText:'Wi-Fi ต่อไม่ได้ครับ',clarification:null});
 expect(result?.searchText).toContain('Wi-Fi ต่อไม่ได้ครับ');expect(result?.searchText).toContain('authentication failed');expect(result?.searchText).not.toContain('PRIVATE_');
 expect(result?.collectedContext[1]).toEqual({field:'DEVICE',source:'U0',quote:'มือถือ Android'});
});
it('rejects invented, assistant-only, unknown-source, whitespace and duplicate-field evidence',()=>{
 for(const facts of [[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ใช้งานได้'}],[{field:'PROBLEM',source:'U2',quote:'PRIVATE_ASSISTANT_RULE'}],[{field:'PROBLEM',source:'U8',quote:'Wi-Fi'}],[{field:'PROBLEM',source:'U0',quote:' '}],[{field:'PROBLEM',source:'U1',quote:'Wi-Fi'},{field:'PROBLEM',source:'U0',quote:'มือถือ'}]])expect(interpretSupportProposal(proposal({facts}),input())).toBeNull();
});
it('requires current canonical departments/categories rather than keyword or arbitrary model routing',()=>{
 expect(interpretSupportProposal(proposal({department:'FINANCE'}),input())).toBeNull();
 expect(interpretSupportProposal(proposal({category:'REGISTRATION'}),input())).toBeNull();
 const source=projectSupportInput({question:'ลงทะเบียนไม่ได้',history:[]},departments);
 expect(interpretSupportProposal(proposal({intent:'PERSONAL_CASE',department:'REGISTRATION',category:'REGISTRATION',subcategory:'COURSE_REGISTRATION',needsTicket:true,needsKnowledgeSearch:false,facts:[{field:'PROBLEM',source:'U0',quote:'ลงทะเบียนไม่ได้'}]}),source)).toMatchObject({departmentCode:'REGISTRAR',sensitiveLevel:'SENSITIVE',needsTicket:true});
});
it('asks only a relevant allowlisted missing fact and does not ask for a device already supplied',()=>{
 expect(interpretSupportProposal(proposal({missingContext:'PREVIOUS_CONNECTION'}),input())?.clarification).toBe('เคยเชื่อมต่อ Wi-Fi หรือระบบนี้ได้มาก่อนหรือไม่ครับ');
 expect(interpretSupportProposal(proposal({missingContext:'DEVICE'}),input())?.clarification).toBeNull();
 expect(interpretSupportProposal(proposal({facts:[]}),input())?.clarification).toBe('ช่วยบอกปัญหาที่ต้องการแก้เพิ่มเติมอีกนิดครับ');
});
it('does not let model urgency or ungrounded impact grant HIGH/CRITICAL priority',()=>{
 expect(interpretSupportProposal(proposal({urgency:'critical',impact:'UNIVERSITY_WIDE'}),input())).toMatchObject({priority:'MEDIUM',severity:'NORMAL'});
 const source=projectSupportInput({question:'Wi-Fi ต่อไม่ได้ หลายคนใช้งานไม่ได้',history:[]},departments);
 expect(interpretSupportProposal(proposal({urgency:'critical',impact:'MULTIPLE_USERS',facts:[{field:'PROBLEM',source:'U0',quote:'Wi-Fi ต่อไม่ได้'},{field:'IMPACT',source:'U0',quote:'หลายคนใช้งานไม่ได้'}]}),source)).toMatchObject({priority:'HIGH',severity:'ELEVATED'});
});
it('does not treat an unrelated literal quote as a report of multiple affected users',()=>{
 expect(interpretSupportProposal(proposal({impact:'MULTIPLE_USERS',facts:[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'IMPACT',source:'U0',quote:'authentication failed'}]}),input())).toMatchObject({priority:'MEDIUM',severity:'NORMAL'});
});
it('raises grounded privacy risk without lowering a current minimum or guessing access to personal records',()=>{
 expect(interpretSupportProposal(proposal(),input(),'RESTRICTED')?.sensitiveLevel).toBe('RESTRICTED');
 expect(interpretSupportProposal(proposal({sensitivity:'RESTRICTED'}),input())).toBeNull();
 const source=projectSupportInput({question:'ปัญหาคุกคาม ต้องการแจ้งเจ้าหน้าที่',history:[]},departments);
 expect(interpretSupportProposal(proposal({intent:'PERSONAL_CASE',needsTicket:true,needsKnowledgeSearch:false,sensitivity:'RESTRICTED',facts:[{field:'PROBLEM',source:'U0',quote:'ปัญหาคุกคาม'},{field:'SENSITIVE_DETAIL',source:'U0',quote:'คุกคาม'}]}),source)).toMatchObject({sensitiveLevel:'RESTRICTED',searchText:null});
});
it('solved intent suggests a confirmation only after delivered guidance and never grants a ticket mutation',()=>{
 const solved=proposal({intent:'SOLVED',needsKnowledgeSearch:false,facts:[]});expect(interpretSupportProposal(solved,input())?.suggestSolved).toBe(false);
 expect(interpretSupportProposal(solved,{...input(),deliveredGuidance:true})).toMatchObject({suggestSolved:true,needsTicket:false,searchText:null});
});
it('low confidence, an absent directory or excessive source content yields no interpreted route',()=>{
 expect(interpretSupportProposal(proposal({confidence:.79}),input())).toBeNull();expect(interpretSupportProposal(proposal(),{...input(),departments:[]})).toBeNull();
 expect(()=>projectSupportInput({question:'ก'.repeat(2001),history:[]},departments)).toThrow('SUPPORT_INPUT_INVALID');
});
it('retains only actual USER system names alongside location without inventing a canonical system',()=>{
 const source=projectSupportInput({question:'ระบบ YRU Passport เข้าไม่ได้ ที่อาคาร 1',history:[]},departments);
 const facts=[{field:'PROBLEM',source:'U0',quote:'เข้าไม่ได้'},{field:'SYSTEM',source:'U0',quote:'YRU Passport'},{field:'LOCATION',source:'U0',quote:'อาคาร 1'}];
 const result=interpretSupportProposal(proposal({subcategory:'SYSTEM_ACCESS',facts}),source);
 expect(result?.collectedContext).toEqual(facts);expect(result?.searchText).toContain('YRU Passport');expect(result?.searchText).toContain('อาคาร 1');
 expect(interpretSupportProposal(proposal({facts:[{field:'SYSTEM',source:'U0',quote:'ระบบลงทะเบียน'}]}),source)).toBeNull();
 expect(interpretSupportProposal(proposal({facts:[facts[1],facts[1]]}),source)).toBeNull();
 expect(interpretSupportProposal(proposal(),input())).not.toBeNull();
});
