import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {staffOutboundDraftInputSchema} from '../lib/chat/staff-outbound-contracts';
vi.mock('server-only',()=>({}));
const base={staffId:randomUUID(),ticketId:randomUUID(),requestId:randomUUID(),revision:3,
 name:'เอกสาร.pdf',mimeType:'application/pdf',byteLength:15,checksum:'a'.repeat(64)};

it('accepts only bounded supported document metadata and sanitizes the display name',()=>{
 expect(staffOutboundDraftInputSchema.parse({...base,name:'../เอกสาร\n.pdf'})).toMatchObject({name:'เอกสาร.pdf'});
 for(const mimeType of ['application/pdf','image/jpeg','image/png'])expect(staffOutboundDraftInputSchema.safeParse({...base,mimeType}).success).toBe(true);
});
it('refuses supplied recipient, session, storage object or unrecognized fields',()=>{
 for(const patch of [{studentId:'attacker'},{lineSessionId:randomUUID()},{userHash:'a'.repeat(64)},{objectId:randomUUID()},{extra:'x'}])
  expect(staffOutboundDraftInputSchema.safeParse({...base,...patch}).success).toBe(false);
});
it('rejects invalid metadata before reservation',()=>{
 for(const patch of [{mimeType:'text/html'},{byteLength:0},{byteLength:10*1024*1024+1},{byteLength:1.1},
  {checksum:'A'.repeat(64)},{checksum:'not-sha256'},{name:'a'.repeat(361)},{revision:-1},{revision:1.5},{requestId:'bad'}])
  expect(staffOutboundDraftInputSchema.safeParse({...base,...patch}).success).toBe(false);
});
