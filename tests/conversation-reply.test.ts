import {expect,it} from 'vitest';
import {createConversationReply,verifyConversationReply,conversationReplyMessages,generalReplyEvidenceReason,generalReplyNeedsEvidence} from '../lib/ai/conversation-reply';
import {projectStaffKnowledgeAdvice} from '../lib/staff/knowledge-assistance-projection';
const context={sessionId:'00000000-0000-4000-8000-000000000001',conversationId:'00000000-0000-4000-8000-000000000002',messageId:'00000000-0000-4000-8000-000000000003',revision:0,question:'Wi-Fi คืออะไร',history:[{role:'assistant' as const,content:'คำตอบก่อนหน้า'}]};
it.each([
 'การเตรียมตัวก่อนยื่นคำร้องทั่วไป คุณควรเรียบเรียงประเด็นหรือปัญหาที่ต้องการแจ้งให้ชัดเจน ระบุชื่อและข้อมูลติดต่อของคุณให้ครบถ้วน พร้อมทั้งเตรียมข้อมูลหรือเอกสารประกอบที่เกี่ยวข้องกับเรื่องนั้น ๆ เพื่อให้เจ้าหน้าที่เข้าใจความต้องการของคุณได้อย่างรวดเร็วครับ',
 'การเตรียมตัวก่อนยื่นคำร้องทั่วไป ควรเริ่มต้นจากการระบุวัตถุประสงค์และเหตุผลความจำเป็นให้ชัดเจน รวบรวมข้อมูลและเอกสารส่วนตัวที่เกี่ยวข้องให้ครบถ้วน เช่น สำเนาบัตรประจำตัวนักศึกษา และตรวจสอบความถูกต้องของข้อมูลก่อนกรอกลงในแบบฟอร์ม เพื่อความสะดวกรวดเร็วในการพิจารณาครับ',
 'ระบุข้อมูลติดต่อของคุณก่อนยื่นคำร้องครับ',
 'รวบรวมข้อมูลและเอกสาร เช่น สำเนาบัตรประจำตัวนักศึกษา ก่อนยื่นครับ',
 'เตรียมเอกสาร เช่น บัตรประจำตัวนักศึกษา ก่อนยื่นครับ',
 'Provide your contact information before submitting the university form.',
])('rejects actual delivered direct-field and combined-document prescriptions: %s',text=>{
 const current={...context,question:'ช่วยบอกวิธีเตรียมตัวก่อนยื่นคำร้อง และแบบฟอร์มคำร้องของมหาวิทยาลัยอยู่ที่ไหน',history:[]};
 expect(generalReplyEvidenceReason(text,current.question)).toBe('INSTITUTIONAL_REQUIREMENT');
 expect(createConversationReply(current,text)).toBeNull();
});
it.each([
 'ระบุชื่อเรื่องและวัตถุประสงค์ให้ชัดเจน แล้วตรวจรายการข้อมูลจากคำแนะนำของแบบที่ใช้ครับ',
 'เตรียมข้อมูลหรือเอกสารตามที่คำแนะนำของแบบฟอร์มระบุ โดยตรวจว่าข้อใดใช้กับเรื่องของคุณครับ',
 'ระบุชื่อไฟล์คู่มือที่ต้องการตรวจสอบครับ',
])('retains form topic/file names and source-dependent preparation without inventing a checklist: %s',text=>{
 expect(createConversationReply({...context,question:'ช่วยเตรียมคำร้อง',history:[]},text)).not.toBeNull();
});
it('retains ordinary resume direct contact-information advice',()=>{
 const current={...context,question:'ช่วยจัดเตรียมเรซูเม่',history:[]};
 expect(createConversationReply(current,'ระบุชื่อและข้อมูลติดต่อของคุณให้ชัดเจนครับ')).not.toBeNull();
 expect(createConversationReply(current,'Provide your contact information clearly.')).not.toBeNull();
});
it.each([
 'สำหรับการเตรียมตัวก่อนยื่นคำร้องทั่วไปนะครับ เบื้องต้นคุณควรระบุวัตถุประสงค์ของการยื่นคำร้องให้ชัดเจน รวบรวมข้อมูลส่วนตัวและรายละเอียดที่เกี่ยวข้องให้ครบถ้วน เช่น รหัสนักศึกษา ชื่อ-นามสกุล คณะ และเบอร์ติดต่อ พร้อมทั้งตรวจสอบความถูกต้องของข้อมูลก่อนนำส่งครับ',
 'รวบรวมข้อมูลส่วนตัวที่เกี่ยวข้อง เช่น รหัสนักศึกษาและคณะ ก่อนยื่นคำร้องครับ',
 'Collect your personal information such as your full name and contact number before submitting the form.',
])('screens a concrete form information checklist even when gather is a separate instruction: %s',text=>{
 const current={...context,question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องทั่วไปและหาลิงก์แบบคำร้องให้ด้วยครับ',history:[]};
 expect(generalReplyEvidenceReason(text,current.question)).toBe('INSTITUTIONAL_REQUIREMENT');
 expect(createConversationReply(current,text)).toBeNull();
});
it('preserves general information organization and ordinary resume contact collection',()=>{
 const text='รวบรวมข้อมูลส่วนตัวที่เกี่ยวข้อง เช่น ชื่อ-นามสกุลและเบอร์ติดต่อ ให้เป็นระเบียบครับ';
 expect(createConversationReply({...context,question:'ช่วยจัดเตรียมเรซูเม่',history:[]},text)).not.toBeNull();
 expect(createConversationReply({...context,question:'ช่วยเตรียมคำร้อง',history:[]},'รวบรวมข้อเท็จจริงของเรื่อง แล้วตรวจรายการข้อมูลจากคำแนะนำของแบบที่ใช้ครับ')).not.toBeNull();
});
it.each([
 {question:'ช่วยแนะนำเรซูเม่ภาษาไทย',text:'ควรระบุชื่อ-นามสกุลและเบอร์ติดต่อให้ชัดเจนครับ'},
 {question:'Help me write a resume.',text:'You should provide your full name and phone number clearly.'},
])('keeps ordinary resume/contact advice out of the institutional should-field screen: $question',({question,text})=>{
 expect(createConversationReply({...context,question,history:[]},text)).not.toBeNull();
});
it('keeps advisory institutional fields screened on a short follow-up using prior USER context only',()=>{
 const question='แล้วควรเตรียมอะไรต่อ',text='ควรระบุชื่อ-นามสกุลและเบอร์ติดต่อให้ครบครับ';
 expect(createConversationReply({...context,question,history:[{role:'user',content:'ผมจะยื่นคำร้องของมหาวิทยาลัย'}]},text)).toBeNull();
 expect(createConversationReply({...context,question,history:[{role:'assistant',content:'คำร้องของมหาวิทยาลัย'}]},text)).not.toBeNull();
});
it.each([
 'การเตรียมตัวก่อนยื่นคำร้องทั่วไป คุณควรระบุชื่อ-นามสกุล รหัสนักศึกษา คณะ สาขาวิชา และเบอร์โทรศัพท์ที่ติดต่อได้ให้ชัดเจน พร้อมทั้งเขียนเหตุผลให้กระชับครับ',
 'ก่อนยื่นคำร้องควรกรอกรหัสนักศึกษาและคณะให้ครบครับ',
 'You should provide your student ID and faculty before submitting the university request.',
])('does not turn unreviewed institutional field advice into safe general help through should/provide wording: %s',text=>{
 const current={...context,question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องทั่วไปและหาลิงก์แบบคำร้องให้ด้วยครับ'};
 expect(generalReplyEvidenceReason(text,current.question)).toBe('INSTITUTIONAL_REQUIREMENT');
 expect(createConversationReply(current,text)).toBeNull();
});
it.each([
 'You should provide the phone model and the program version to diagnose the problem.',
 'ควรระบุรุ่นมือถือและเวอร์ชันของแอปเพื่อเลือกวิธีตรวจครับ',
])('retains ordinary software/device diagnostic advice with should/provide wording: %s',text=>{
 expect(createConversationReply({...context,question:'ช่วยตรวจแอปในมือถือ Android ที่เชื่อมต่อไม่ได้'},text)).not.toBeNull();
});
it.each([
 'Wi-Fi ของมหาวิทยาลัย (เช่น YRU-WiFi) หรือเครือข่ายส่วนตัวครับ',
 'ระบบของมหาวิทยาลัย เช่น CAMPUS-AUTH ใช้ได้ครับ',
 'Connect to the university network, for example CampusNet.',
 'The campus network is named CampusGuest.',
])('requires reviewed evidence for a named institutional network/system example: %s',text=>{
 expect(generalReplyEvidenceReason(text)).toBe('INSTITUTIONAL_TOPIC');
 expect(createConversationReply(context,text)).toBeNull();
});
it.each([
 'ขอสอบถามว่าใช้งาน Wi-Fi ของมหาวิทยาลัยหรือเครือข่ายส่วนตัวครับ',
 'รบกวนแจ้งชื่อเครือข่ายของมหาวิทยาลัยที่ใช้อยู่ครับ',
 'กรุณาระบุอุปกรณ์ เช่น Android หรือ iPhone ครับ',
 'Please provide the name of the university network you use.',
])('allows asking for real network context and general device examples: %s',text=>{
 expect(generalReplyEvidenceReason(text)).toBeNull();
 expect(createConversationReply(context,text)).not.toBeNull();
});
it.each([
 'ต้องแนบสำเนาบัตรประชาชนและใบแสดงผลการศึกษา',
 '1) รวบรวมเอกสารหลักฐานที่จำเป็น เช่น สำเนาบัตรประชาชน ใบแสดงผลการศึกษา จดหมายแนะนำ 2) เขียนให้ชัดเจน',
 'You must attach a transcript and a copy of your ID.',
 'Required documents: a transcript and an ID card copy.',
 'รวบรวมเอกสารสนับสนุนที่เกี่ยวข้อง เช่น ผลการเรียน จดหมายแนะนำ หลักฐานการชำระเงิน หรือหนังสืออนุมัติจากอาจารย์ที่ปรึกษา',
 'เตรียมเอกสาร เช่น หลักฐานการชำระเงิน ก่อนยื่นคำร้องครับ',
 'Gather supporting documents such as transcripts and recommendation letters.',
])('requires evidence for specific attachment requirements: %s',text=>{
 expect(generalReplyEvidenceReason(text)).toBe('INSTITUTIONAL_REQUIREMENT');
 expect(createConversationReply(context,text)).toBeNull();
});
it.each([
 'รวบรวมข้อมูลที่มี เขียนจุดประสงค์ให้ชัดเจน และตรวจรายการเอกสารจากคำแนะนำของแบบฟอร์มครับ',
 'Organize your information and check the official instructions for required documents.',
 'ตรวจสอบก่อนว่าต้องแนบเอกสารอะไรตามคำแนะนำของแบบฟอร์มครับ',
 'ช่วยร่างจดหมายแนะนำโดยใช้ข้อมูลที่คุณให้มาได้ครับ',
 'รวบรวมข้อมูลที่มีและตรวจคำแนะนำของแบบฟอร์มก่อนยื่นครับ',
])('keeps general preparation without inventing attachments: %s',text=>{
 expect(createConversationReply(context,text)).not.toBeNull();
});
it.each([
 'รวบรวมข้อมูลและข้อเท็จจริงที่จำเป็น เช่น รหัสนักศึกษา ชื่อ-นามสกุล คณะ สาขา และเบอร์ติดต่อที่สะดวก',
 'ข้อมูลที่ต้องกรอก ได้แก่ ชื่อ นามสกุล และหมายเลขโทรศัพท์ครับ',
 'ข้อมูลที่ต้องใช้ในการยื่นคำร้องคือรหัสนักศึกษาและสาขาครับ',
 'ก่อนยื่นคำร้องจำเป็นต้องระบุรหัสนักศึกษาและเบอร์ติดต่อครับ',
 'You must provide your student ID and phone number before submitting the request.',
 'The required information includes your full name, faculty and telephone number.',
 'Necessary personal details: student number and contact number.',
 'ข้อมูลที่จำเป็น ได้แก่:\n- รหัสนักศึกษา\n- ชื่อ-นามสกุล\n- หลักสูตร\n- เบอร์ติดต่อ',
 'Required information:\n- Full name\n- Program\n- Phone number',
 'Required information:\n1. Full name\n2. Program\n3. Phone number',
 'You must provide your full name and phone number.',
 'Required information: program and phone number',
 'Required information: program and phone',
 'Mandatory details: major and curriculum',
 'ข้อมูลที่ต้องใช้คือหลักสูตรครับ',
])('requires reviewed evidence before asserting mandatory personal fields: %s',text=>{
 const formContext={...context,question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องและหาลิงก์แบบคำร้องให้ด้วยครับ'};
 expect(generalReplyEvidenceReason(text,formContext.question)).toBe('INSTITUTIONAL_REQUIREMENT');
 expect(createConversationReply(formContext,text)).toBeNull();
});
it.each([
 'You need to provide the program name so I can suggest the next check.',
 'Required information: phone model and Android version.',
 'Your solution must include a program that prints the result.',
 'The required information for diagnosing this connection is the program version and phone model.',
])('keeps ordinary diagnostic/programming meaning when the original task is not a form request: %s',text=>{
 const generalContext={...context,question:'I am debugging a small Android app; can you help me investigate?'};
 const reply=createConversationReply(generalContext,text);
 expect(reply?.text).toBe(text);expect(verifyConversationReply(reply!,generalContext)).toBe(true);
});
it.each([
 'I am debugging the login form in my Android app.',
 'ช่วยตรวจโปรแกรมแบบฟอร์มล็อกอินในแอป Android ให้หน่อยครับ',
])('does not treat an app UI form as an institutional request: %s',question=>{
 const text='The required information for diagnosing this is the program version and phone model.',current={...context,question};
 const reply=createConversationReply(current,text);expect(reply?.text).toBe(text);expect(verifyConversationReply(reply!,current)).toBe(true);
});
it.each([
 'Which information is required for a university request form?',
 'What does the student form require?',
 'แบบฟอร์มของมหาวิทยาลัยต้องเตรียมข้อมูลอะไรบ้างครับ',
])('retains ambiguous-field protection for an explicitly institutional form: %s',question=>{
 expect(createConversationReply({...context,question},'Required information: program and phone')).toBeNull();
});
it.each([
 'รวบรวมข้อมูลที่มีและตรวจสอบคำแนะนำของแบบฟอร์มว่าให้กรอกข้อมูลใดบ้างครับ',
 'ตรวจสอบก่อนว่าข้อมูลที่จำเป็นมีอะไรบ้างตามคำแนะนำของแบบฟอร์มครับ',
 'ถ้าต้องการให้เจ้าหน้าที่ติดต่อกลับ ให้เลือกช่องทางติดต่อที่สะดวกครับ',
 'ช่วยจัดรูปแบบชื่อและเบอร์ติดต่อที่คุณให้มาในอีเมลได้ครับ',
 'Your draft can end with your preferred contact method.',
 'Check the form instructions to find which personal details are required.',
 'Organize information you already have; do not send personal identifiers in this chat.',
 'ตรวจสอบข้อมูลที่จำเป็นจากคำแนะนำของแบบฟอร์ม\n\nตัวอย่างอีเมล: ชื่อ-นามสกุลและเบอร์ติดต่อที่คุณให้มาครับ',
 'Check the required information in the instructions.\n\nWriting example: your full name and phone number.',
 'Do not send your student ID or phone number in this chat.',
])('keeps preparation and writing advice without inventing mandatory fields: %s',text=>{
 expect(createConversationReply(context,text)).not.toBeNull();
});
it.each([
 ['มหาวิทยาลัย: 1. อ่านรายละเอียดให้ครบ 2. เตรียมเอกสารตามที่ระบุ',null],
 ['สอบถามค่าธรรมเนียมก่อนยื่นคำร้อง','INSTITUTIONAL_TOPIC'],
 ['Wi-Fi ใช้คลื่นวิทยุ',null],
])('identifies a fixed screening reason without returning prose: %s',(text,reason)=>{
 expect(generalReplyEvidenceReason(text)).toBe(reason);
});
it.each(['อ่านคำแนะนำของมหาวิทยาลัยให้ครบ 2. เขียนจุดประสงค์ให้ชัดเจน','ตรวจรายละเอียดจากมหาวิทยาลัย\n2) จัดข้อมูลที่มีให้เป็นระเบียบ'])('does not interpret the next list marker as an official numeric fact',text=>{
 expect(createConversationReply(context,text)).not.toBeNull();
});
it.each(['2.','๒)','2)'])('does not join an instruction to the next numbered step (%s)',marker=>{
 const text=`1. ปิดเครื่องแล้วเปิดใหม่เพื่อรีเซ็ตสแต็กเครือข่าย ${marker} ลืมเครือข่ายแล้วต่อใหม่ครับ`;
 const reply=createConversationReply(context,text);
 expect(reply?.text).toBe(text);expect(verifyConversationReply(reply!,context)).toBe(true);
});
it.each(['1. รีเซ็ตบัญชีให้แล้วครับ 2. ลองเข้าใหม่','1. ลองเข้าใหม่ 2. ผมเปลี่ยนรหัสผ่านเรียบร้อยแล้ว','1. ค่าเทอมคือ 15000 บาท 2. เตรียมเอกสาร'])('still rejects real claims within numbered steps: %s',text=>{
 expect(createConversationReply(context,text)).toBeNull();
});
it('preserves full general prose across LINE packets',()=>{
 const text='Wi-Fi เชื่อมอุปกรณ์แบบไร้สายครับ 🧑‍💻\n'.repeat(350),reply=createConversationReply(context,text);
 expect(reply).not.toBeNull();expect(reply?.kind).toBe('CONVERSATION');
 const messages=conversationReplyMessages(reply!);expect(messages.length).toBeGreaterThan(1);
 expect(messages.map(m=>m.text).join('')).toBe(text);expect(messages.every(m=>m.text.length<=5000)).toBe(true);
});
it('binds the exact owner, original question and delivered history',()=>{
 const reply=createConversationReply(context,'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ')!;
 expect(verifyConversationReply(reply,context)).toBe(true);
 for(const changed of [{question:'another'},{revision:1},{messageId:'00000000-0000-4000-8000-000000000009'},{history:[]}])expect(verifyConversationReply(reply,{...context,...changed})).toBe(false);
});
it.each(['ค่าเทอมมหาวิทยาลัยคือ 15000 บาท','ลงทะเบียนวันที่ 12 พฤศจิกายน','บัญชีของคุณถูกระงับแล้ว','เปิดเคสและส่งต่อเจ้าหน้าที่เรียบร้อยแล้ว','Your tuition fee is 500 baht.','I have reset your password.','ดูที่ https://fake.example','ตามระเบียบมหาวิทยาลัย คุณมีสิทธิ์ได้รับเงิน'])('blocks unsupported claim from a general result: %s',text=>{
 expect(createConversationReply(context,text)).toBeNull();
});
it('does not label a general answer as verified guidance or support authority',()=>{
 const result=createConversationReply(context,'18 × 7 = 126 ครับ')!;
 expect(result.basis).toBe('GENERAL_MODEL');expect(result).not.toHaveProperty('support');expect(result).not.toHaveProperty('citations');
});
it('rejects oversized answers without silently truncating',()=>{expect(createConversationReply(context,'ก'.repeat(20001))).toBeNull();});
it('cannot be projected as verified Staff knowledge advice',()=>{
 expect(()=>projectStaffKnowledgeAdvice(createConversationReply(context,'คำอธิบายทั่วไป')!,0)).toThrow('GENERAL_REPLY_NOT_KNOWLEDGE_ADVICE');
});
it.each(['รับสมัครถึงวันที่ 31 พฤษภาคม 2569','ห้องสมุดปิด 20:00 ครับ','เปิดภาคเรียนวันที่ 12 พฤศจิกายน 2569','YRU admissions close on May 31, 2026','The university library closes at 20:00'])('screens official service/calendar claims with ordinary wording: %s',text=>{
 expect(createConversationReply(context,text)).toBeNull();
});
it.each(['ตัวอย่างอีเมล: เราขอนัดคุยวันที่ 12 พฤศจิกายน 2569','ตั้งเวลาอ่านหนังสือ 20:00 แล้วพักทุก 25 นาทีครับ'])('keeps general writing and time-management examples: %s',text=>{
 expect(createConversationReply(context,text)).not.toBeNull();
});
it('cannot deliver document requirements attributed to a notice from unverified general output',()=>{
 const text='จากประกาศสำหรับกลุ่มทดลอง เอกสารที่ต้องเตรียมตามขั้นตอนคือ แบบ ก-ทดสอบ และสำเนาหลักฐานการศึกษา';
 expect(generalReplyNeedsEvidence(text)).toBe(true);
});
it('checks the corpus before claiming an official guide is unavailable to this assistant',()=>{
 expect(generalReplyNeedsEvidence('ผมมองไม่เห็นไฟล์คู่มือที่คุณแนบมา รบกวนคัดลอกเนื้อหาในคู่มือ')).toBe(true);
});
