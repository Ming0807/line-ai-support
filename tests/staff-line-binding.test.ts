import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {parseBindingCommand,bindingChallengeInput,bindingStatusSchema} from '@/lib/staff/line-binding-contracts';

it('recognizes only the exact canonical 256-bit setup command',()=>{
 const token=randomBytes(32).toString('base64url');
 expect(parseBindingCommand(`yru:staff:bind:${token}`)).toBe(token);
 for(const text of [` yru:staff:bind:${token}`,`yru:staff:bind:${token}\n`,`yru:staff:bind:${token}=`,`yru:staff:bind:${'a'.repeat(43)}`,'สวัสดี','yru:staff:accept:'+token])expect(parseBindingCommand(text)).toBeNull();
});
it('accepts only the authenticated-self request contract and privacy-safe status',()=>{
 const id='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
 expect(bindingChallengeInput.parse({requestId:id})).toEqual({requestId:id});
 for(const input of [{requestId:id,staffId:id},{requestId:id,role:'SUPER_ADMIN'},{requestId:'bad'},{}])expect(bindingChallengeInput.safeParse(input).success).toBe(false);
 expect(bindingStatusSchema.parse({bound:false,pending:true,expiresAt:'2026-10-08T09:00:00.000Z'})).toEqual({bound:false,pending:true,expiresAt:'2026-10-08T09:00:00.000Z'});
 for(const input of [{bound:true,pending:false,expiresAt:null,userId:'Uprivate'},{bound:false,pending:true,expiresAt:null},{bound:true,pending:true,expiresAt:'2026-10-08T09:00:00.000Z'}])expect(bindingStatusSchema.safeParse(input).success).toBe(false);
});
