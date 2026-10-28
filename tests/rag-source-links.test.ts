import {describe,it,expect} from 'vitest';
import {buildCitedAnswer,ragAnswerSchema,lineMessages} from '../lib/knowledge/citations';
import type {KnowledgeEvidence} from '../lib/knowledge/types';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const row:KnowledgeEvidence={chunkId:first,documentId:'33333333-3333-4333-8333-333333333333',documentRevision:1,title:'YRU Passport official service',familyCode:'YRU_PASSPORT',academicYear:null,authorityLevel:50,pageNumber:null,sectionTitle:null,sourceUrl:'https://nse.yru.ac.th/page/31',similarity:0.9,content:'เข้าใช้ YRU Passport ที่ http://passport.yru.ac.th แล้วลงทะเบียนอุปกรณ์'};
const render=(answer:string,available:KnowledgeEvidence[]=[row],ids:string[]=[first])=>buildCitedAnswer({answer,citationChunkIds:ids},available).messages.map(m=>m.text).join('');

describe('backend binds answer links to the cited reviewed source',()=>{
 it('accepts the actual-shaped legacy Passport source link without discarding or clipping the full answer',()=>{
  const answer='ขั้นตอนเชื่อมต่อ\n1. เข้า http://passport.yru.ac.th\n2. ลงชื่อเข้าใช้ YRU Passport\n3. เลือก Register YRU WIFI และกรอก Mac Address 12 หลัก';
  expect(ragAnswerSchema.safeParse({answer,citationChunkIds:[first]}).success).toBe(true);
  expect(render(answer)).toBe(answer+'\n\nแหล่งอ้างอิง:\n1. YRU Passport official service\nhttps://nse.yru.ac.th/page/31');
 });
 it('accepts only the exact primary source metadata URL when it is not repeated in body text',()=>{
  expect(render('เปิดต้นฉบับที่ https://nse.yru.ac.th/page/31')).toContain('เปิดต้นฉบับที่ https://nse.yru.ac.th/page/31');
 });
 it('keeps sentence punctuation and parentheses while matching exact reviewed link tokens',()=>{
  expect(render('เปิด (http://passport.yru.ac.th).')).toContain('เปิด (http://passport.yru.ac.th).');
 });
 it('does not use an available but uncited source to authorize a URL',()=>{
  const other={...row,chunkId:second,content:'ระบบ https://service.yru.ac.th/login'};
  expect(()=>render('เปิด https://service.yru.ac.th/login',[row,other])).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
 it('rejects a URL which is merely a prefix of a longer reviewed URL',()=>{
  expect(()=>render('เปิด https://service.yru.ac.th/login',[{...row,content:'https://service.yru.ac.th/login-secret'}])).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
 it.each([
  'https://passport.yru.ac.th/invented','http://passport.yru.ac.th.evil.example','http://evil.example/?next=passport.yru.ac.th',
  'http://user:password@passport.yru.ac.th','http://passport.yru.ac.th:8080','http://passport.yru.ac.th/%0d%0aInjected',
  'ftp://passport.yru.ac.th/file','www.evil.example/path','//passport.yru.ac.th','passport.yru.ac.th','evil.example/login',
  'javascript:alert(1)','data:text/html,unsafe','mailto:someone@evil.example','geo:0,0','filesystem:http://passport.yru.ac.th',
 ])('rejects an unbound or unsafe model link: %s',url=>{
  expect(()=>render('เปิด '+url)).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
 it.each(['http://user:password@passport.yru.ac.th','http://passport.yru.ac.th:8080','https://passport.yru.ac.th:443','http://passport.yru.ac.th/%0d%0aInjected','http://passport.yru.ac.th/%250dInjected','http://passport.yru.ac.th/%252525250dInjected','https://evil.example/login'])('denies unsafe/non-YRU body links even when repeated literally in reviewed text: %s',url=>{
  expect(()=>render('เปิด '+url,[{...row,content:'ลิงก์ '+url}])).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
 it('requires current source content to retain the exact link',()=>{
  expect(()=>render('เปิด http://passport.yru.ac.th',[{...row,content:'เนื้อหาเปลี่ยน ไม่มีลิงก์เดิม'}])).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
 it('keeps a valid link atomic at a 5000 UTF-16 LINE boundary, with the complete answer unchanged',()=>{
  const url='http://passport.yru.ac.th',answer='ก'.repeat(4990)+' '+url+'\nขั้นตอนถัดไป';
  const result=buildCitedAnswer({answer,citationChunkIds:[first]},[row]);
  expect(result.messages.some(m=>m.text.includes(url))).toBe(true);
  expect(result.messages.every(m=>m.text.length<=5000)).toBe(true);
  expect(result.messages.map(m=>m.text).join('')).toContain(answer);
 });
 it('does not split canonical reference links across packets either',()=>{
  const url='https://nse.yru.ac.th/'+'a'.repeat(80),value='ก'.repeat(4995)+'\n'+url;
  const messages=lineMessages(value);expect(messages.some(m=>m.text.includes(url))).toBe(true);
  expect(messages.map(m=>m.text).join('')).toBe(value);
 });
 it('allows percent-encoded spaces in an exact reviewed YRU path without admitting encoded controls',()=>{
  const url='https://service.yru.ac.th/blank%20form.pdf';
  expect(render('เปิด '+url,[{...row,content:'ดาวน์โหลด '+url}])).toContain(url);
 });
 it('retains an exact reviewed bare YRU domain as plain source text without inventing its protocol',()=>{
  const answer='เปิด passport.yru.ac.th';
  expect(render(answer,[{...row,content:'เว็บไซต์ passport.yru.ac.th'}])).toContain(answer);
  const packets=lineMessages('ก'.repeat(4990)+' passport.yru.ac.th');
  expect(packets.some(p=>p.text.includes('passport.yru.ac.th'))).toBe(true);
 });
 it('bounds link occurrences and rejects an overlong atomic URL without clipping',()=>{
  expect(()=>render(Array.from({length:21},()=> 'http://passport.yru.ac.th').join('\n'))).toThrow('KNOWLEDGE_CITATION_INVALID');
  expect(()=>lineMessages('https://nse.yru.ac.th/'+'a'.repeat(5000))).toThrow('LINE_TEXT_PACKET_TOO_LARGE');
 });
 it('does not weaken model-controlled source metadata or invented citation rejection',()=>{
  expect(()=>buildCitedAnswer({answer:'อ่านเอกสาร',citationChunkIds:[first],sourceUrl:'https://evil.example'},[row])).toThrow('KNOWLEDGE_CITATION_INVALID');
  expect(()=>render('http://passport.yru.ac.th',[row],[second])).toThrow('KNOWLEDGE_CITATION_INVALID');
 });
});
