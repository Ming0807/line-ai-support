import {expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {enqueueOutbound} from '../lib/queue/outbox';

it('rejects cross-channel kinds before executing SQL',async()=>{
 const client={query:vi.fn().mockResolvedValue({rows:[{id:randomUUID()}],rowCount:1})},key=randomBytes(32).toString('base64');
 await expect(enqueueOutbound(client,{idempotencyKey:randomUUID(),channel:'STAFF',kind:'STAFF',recipientStaffId:randomUUID(),messages:[{type:'text',text:'Test'}]},key)).rejects.toThrow('INVALID_OUTBOX_CHANNEL_KIND');
 await expect(enqueueOutbound(client,{idempotencyKey:randomUUID(),channel:'STUDENT',kind:'NOTIFICATION',lineSessionId:randomUUID(),messages:[{type:'text',text:'Test'}]},key)).rejects.toThrow('INVALID_OUTBOX_CHANNEL_KIND');
 expect(client.query).not.toHaveBeenCalled();
});
