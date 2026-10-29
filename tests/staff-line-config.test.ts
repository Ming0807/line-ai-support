import {expect,it} from 'vitest';
import {readStaffLineConfig} from '@/lib/auth/line-staff-config';

const fixtureKey=Buffer.alloc(32,0x2a).toString('base64');
const baseline:NodeJS.ProcessEnv={
  NODE_ENV:'test',
  APP_BASE_URL:'http://localhost:3000',
  SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',
  ENCRYPTION_KEY:fixtureKey,
  LINE_STAFF_LOGIN_ENABLED:'true',
  LINE_STAFF_SAME_PROVIDER_CONFIRMED:'true',
};

function read(source:NodeJS.ProcessEnv) {
  try{return readStaffLineConfig(source);}catch{return null;}
}

it('advertises LINE login only when both explicit flags and required local configuration are present',()=>{
  expect(read(baseline)).toEqual({loginAvailable:true,sameProviderConfirmed:true});
});

it('requires literal true for both operator confirmations',()=>{
  for(const value of ['false','TRUE','1','']) {
    expect(read({...baseline,LINE_STAFF_LOGIN_ENABLED:value})?.loginAvailable).toBe(false);
    expect(read({...baseline,LINE_STAFF_SAME_PROVIDER_CONFIRMED:value})?.loginAvailable).toBe(false);
  }
  expect(read({...baseline,LINE_STAFF_LOGIN_ENABLED:undefined})?.loginAvailable).toBe(false);
  expect(read({...baseline,LINE_STAFF_SAME_PROVIDER_CONFIRMED:undefined})?.loginAvailable).toBe(false);
});

it('does not advertise a working login when encryption, Supabase URL or publishable key is missing',()=>{
  for(const source of [
    {...baseline,ENCRYPTION_KEY:undefined},
    {...baseline,SUPABASE_URL:undefined,NEXT_PUBLIC_SUPABASE_URL:undefined},
    {...baseline,SUPABASE_PUBLISHABLE_KEY:undefined,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:undefined},
  ]) expect(read(source)?.loginAvailable).toBe(false);
});

it('rejects unsafe, non-root or non-loopback HTTP application base URLs as unavailable',()=>{
  for(const APP_BASE_URL of [
    'http://untrusted.example.edu',
    'http://localhost:3000/app',
    'https://staff.example.edu/app',
    'https://user:password@staff.example.edu',
    'not-a-url',
  ]) expect(read({...baseline,APP_BASE_URL})?.loginAvailable??false).toBe(false);
});

it('keeps setup observations separate when login is disabled or same-provider confirmation is absent',()=>{
  expect(read({...baseline,LINE_STAFF_LOGIN_ENABLED:'false'})).toEqual({loginAvailable:false,sameProviderConfirmed:true});
  expect(read({...baseline,LINE_STAFF_SAME_PROVIDER_CONFIRMED:'false'})).toEqual({loginAvailable:false,sameProviderConfirmed:false});
});
