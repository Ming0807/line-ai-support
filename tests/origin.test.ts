import {expect,it} from 'vitest';
import {isSameOrigin} from '../lib/security/origin';
it('uses the external Host when Next normalizes its internal URL',()=>{
 expect(isSameOrigin(new Request('http://localhost:3001/api',{headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001','x-forwarded-proto':'http'}}))).toBe(true);
});
it('rejects foreign origin, scheme mismatch, missing Origin and appended paths',()=>{
 for(const origin of ['https://evil.invalid','https://localhost:3001','http://localhost:3001/path','null'])
  expect(isSameOrigin(new Request('http://localhost:3001/api',{headers:{host:'localhost:3001',origin}}))).toBe(false);
 expect(isSameOrigin(new Request('http://localhost:3001/api',{headers:{host:'localhost:3001'}}))).toBe(false);
});
it('accepts the external HTTPS origin through the configured reverse proxy',()=>{
 expect(isSameOrigin(new Request('http://localhost:3000/api',{headers:{host:'helpdesk.example.org',origin:'https://helpdesk.example.org','x-forwarded-proto':'https'}}))).toBe(true);
});
