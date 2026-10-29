import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {
  parseLineFlowRequest,
  createLineFlowCookie,
  readLineFlowCookie,
  trustedLineCallbackUrl,
} from '@/lib/auth/line-staff-flow';

const key=randomBytes(32).toString('base64');
const userId='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const issuedAt=Date.UTC(2026,9,29,3,0,0);

it('defaults LINE login to sign-in and the fixed application path',()=>{
  expect(parseLineFlowRequest(new URLSearchParams())).toEqual({mode:'signin',next:'/staff/apply'});
});

it('accepts only fixed sign-in/link modes and fixed local destinations',()=>{
  expect(parseLineFlowRequest(new URLSearchParams('mode=link&next=%2Fstaff%2Fapplication')))
    .toEqual({mode:'link',next:'/staff/application'});
  expect(parseLineFlowRequest(new URLSearchParams('mode=signin&next=%2Fdashboard')))
    .toEqual({mode:'signin',next:'/dashboard'});
  expect(parseLineFlowRequest(new URLSearchParams('next=%2Fstaff%2Fapplication')))
    .toEqual({mode:'signin',next:'/staff/application'});
});

it('rejects unknown, duplicated, malformed or open-redirect flow parameters',()=>{
  for(const query of [
    'unexpected=x',
    'mode=unknown',
    'mode=link&mode=signin',
    'next=%2Fdashboard&next=%2Fstaff%2Fapply',
    'next=https%3A%2F%2Fevil.example',
    'next=%2F%2Fevil.example',
    'next=%2Fstaff%2Fapply%3Fredirect%3Dhttps%3A%2F%2Fevil.example',
    'mode=',
  ]) expect(parseLineFlowRequest(new URLSearchParams(query))).toBeNull();
});

it('encrypts and round-trips a sign-in flow without granting an Auth subject',()=>{
  const cookie=createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,issuedAt);
  expect(typeof cookie).toBe('string');
  expect(cookie).not.toContain('signin');
  expect(cookie).not.toContain('/staff/apply');
  expect(cookie).not.toContain(userId);
  const flow=readLineFlowCookie(cookie,key,issuedAt+1);
  expect(flow).toMatchObject({mode:'signin',next:'/staff/apply',userId:null,issuedAt,expiresAt:issuedAt+600_000});
  expect(typeof flow?.nonce).toBe('string');
  expect(flow?.nonce).not.toHaveLength(0);
});

it('binds explicit linking to the same Auth subject and creates a fresh nonce per flow',()=>{
  const input={mode:'link' as const,next:'/staff/application' as const,userId};
  const first=createLineFlowCookie(input,key,issuedAt);
  const second=createLineFlowCookie(input,key,issuedAt);
  expect(second).not.toBe(first);
  expect(readLineFlowCookie(first,key,issuedAt+1)).toMatchObject({
    mode:'link',next:'/staff/application',userId,issuedAt,expiresAt:issuedAt+600_000,
  });
});

it('rejects a missing or invalid subject for link mode and a subject on sign-in mode',()=>{
  expect(()=>createLineFlowCookie({mode:'link',next:'/staff/application',userId:null},key,issuedAt)).toThrow();
  expect(()=>createLineFlowCookie({mode:'link',next:'/staff/application',userId:'not-a-uuid'},key,issuedAt)).toThrow();
  expect(()=>createLineFlowCookie({mode:'signin',next:'/staff/apply',userId},key,issuedAt)).toThrow();
});

it('rejects tampered, wrong-key, expired and future-issued flow cookies',()=>{
  const cookie=createLineFlowCookie({mode:'signin',next:'/dashboard',userId:null},key,issuedAt);
  expect(readLineFlowCookie(`${cookie}x`,key,issuedAt+1)).toBeNull();
  expect(readLineFlowCookie(cookie,randomBytes(32).toString('base64'),issuedAt+1)).toBeNull();
  expect(readLineFlowCookie(cookie,key,issuedAt+600_000)).toBeNull();
  expect(readLineFlowCookie(cookie,key,issuedAt-1)).toBeNull();
  expect(readLineFlowCookie('malformed-cookie',key,issuedAt)).toBeNull();
});

it('builds the canonical callback URL only from a safe trusted application origin',()=>{
  expect(trustedLineCallbackUrl('https://staff.example.edu')).toBe('https://staff.example.edu/auth/callback');
  expect(trustedLineCallbackUrl('http://localhost:3000')).toBe('http://localhost:3000/auth/callback');
  expect(trustedLineCallbackUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/auth/callback');
});

it('rejects non-HTTPS public origins, non-root paths, credentials, query, hash and unsafe hosts',()=>{
  for(const base of [
    'http://staff.example.edu',
    'ftp://staff.example.edu',
    'https://staff.example.edu/app',
    'https://user:password@staff.example.edu',
    'https://staff.example.edu?next=/dashboard',
    'https://staff.example.edu#callback',
    'http://example.com:3000',
    'not a URL',
  ]) expect(trustedLineCallbackUrl(base)).toBeNull();
});
