import {describe,it,expect} from 'vitest';
import {selectStaffCaseSnapshot} from '../lib/staff/line-case-snapshot';
import {formatStaffCase} from '../lib/staff/line-chat-presentation';
describe('Staff case full-message acknowledgment snapshot',()=>{
 it('splits a 5000-unit source without losing text while bounding LINE to five messages',()=>{
  const text='🙂'.repeat(2500),code='YRU-00000001 / ANON-1';
  const snapshot=selectStaffCaseSnapshot(code,[{content:text,message_seq:'11'}],'0');
  const rendered=formatStaffCase({code,messages:snapshot.messages,hasOlder:snapshot.hasMore,buttons:[]});
  const prefix=`เคส ${code} · ข้อความจากผู้ใช้:\n`;
  expect(rendered.slice(0,-1).map(row=>row.text.slice(prefix.length)).join('')).toBe(text);
  expect(rendered.length).toBeLessThanOrEqual(5);expect(rendered.every(row=>row.text.length<=5000)).toBe(true);
  expect(snapshot.readThrough).toBe('11');expect(snapshot.hasMore).toBe(false);
 });
 it('leaves later source messages outside the four-frame acknowledgment snapshot',()=>{
  const snapshot=selectStaffCaseSnapshot('YRU-1',[
   {content:'a'.repeat(5000),message_seq:'11'},{content:'b'.repeat(5000),message_seq:'12'},{content:'later',message_seq:'13'}],'10');
  expect(snapshot.readThrough).toBe('12');expect(snapshot.messages).toHaveLength(2);expect(snapshot.hasMore).toBe(true);
 });
 it('never acknowledges a source that cannot fit in the bounded LINE snapshot',()=>{
  const snapshot=selectStaffCaseSnapshot('YRU-1',[{content:'x'.repeat(20_000),message_seq:'11'}],'10');
  expect(snapshot.readThrough).toBe('10');expect(snapshot.hasMore).toBe(true);expect(snapshot.messages).toHaveLength(1);
 });
});
