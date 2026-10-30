import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createStudentMediaSession,openStudentMediaSession} from '../lib/chat/student-media-session';

vi.mock('server-only',()=>({}));
const key=randomBytes(32).toString('base64'),id=randomUUID(),userHash='a'.repeat(64),now=1_700_000_000;
it('binds an opaque encrypted session to one attachment and the verified identity expiry',()=>{
 const session=createStudentMediaSession({attachmentId:id,userHash,identityExpiresAt:now+100},key,now);
 expect(session).not.toContain(userHash);expect(session).not.toContain(id);
 expect(openStudentMediaSession(session,id,key,now+99)).toEqual({userHash,expiresAt:now+100});
 expect(()=>openStudentMediaSession(session,id,key,now+100)).toThrow('INVALID_STUDENT_MEDIA_SESSION');
 expect(()=>openStudentMediaSession(session,randomUUID(),key,now+1)).toThrow('INVALID_STUDENT_MEDIA_SESSION');
});
it('caps lifetime at five minutes and rejects a future-issued session',()=>{
 const session=createStudentMediaSession({attachmentId:id,userHash,identityExpiresAt:now+3600},key,now);
 expect(openStudentMediaSession(session,id,key,now+299).expiresAt).toBe(now+300);
 expect(()=>openStudentMediaSession(session,id,key,now+300)).toThrow();
 expect(()=>openStudentMediaSession(session,id,key,now-1)).toThrow();
});
it('rejects tampering, wrong key, malformed data and invalid identity proof',()=>{
 const session=createStudentMediaSession({attachmentId:id,userHash,identityExpiresAt:now+20},key,now);
 const parts=session.split('.'),payload=parts.at(-1)!;parts[parts.length-1]=(payload[0]==='A'?'B':'A')+payload.slice(1);
 for(const value of [parts.join('.'),'invalid','x'.repeat(2000)])expect(()=>openStudentMediaSession(value,id,key,now)).toThrow();
 expect(()=>openStudentMediaSession(session,id,randomBytes(32).toString('base64'),now)).toThrow();
 for(const input of [{attachmentId:'bad',userHash,identityExpiresAt:now+20},{attachmentId:id,userHash:'bad',identityExpiresAt:now+20},
  {attachmentId:id,userHash,identityExpiresAt:now}])expect(()=>createStudentMediaSession(input,key,now)).toThrow();
});
it('uses a fresh nonce for every session with the same binding',()=>{
 const input={attachmentId:id,userHash,identityExpiresAt:now+20};
 expect(createStudentMediaSession(input,key,now)).not.toBe(createStudentMediaSession(input,key,now));
});
