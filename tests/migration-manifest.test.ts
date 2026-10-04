import { describe, expect, it } from 'vitest';
import { applicationTables } from '../lib/database/migration-manifest';

describe('development migration preflight',()=>{
 it('recognizes quoted Supabase CLI table names and plain qualified names',()=>{
  expect(applicationTables('CREATE TABLE "private"."webhook_inbox" (id uuid); create table public.staff_profiles (id uuid);'))
   .toEqual(['private.webhook_inbox','public.staff_profiles']);
 });
 it('keeps system schemas outside the application allowlist',()=>{
  expect(applicationTables('create table auth.users (id uuid); create table storage.objects (id uuid);'))
   .toEqual([]);
 });
});
