import { describe, expect, it } from 'vitest';
import { assertDevelopmentTarget } from '../lib/database/development-target';

const ref='abcdefghijklmnopqrst';
const fixture={environment:'development',projectRef:ref,supabaseUrl:`https://${ref}.supabase.co`,
 directUrl:`postgresql://postgres.${ref}:fixture-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`};

describe('development-only database writes',()=>{
 it('allows the explicitly matched development project',()=>{
  expect(()=>assertDevelopmentTarget(fixture,ref)).not.toThrow();
  expect(()=>assertDevelopmentTarget({...fixture,directUrl:`postgresql://postgres:fixture-password@db.${ref}.supabase.co:5432/postgres`},ref)).not.toThrow();
 });
 it.each([
  {...fixture,environment:undefined}, {...fixture,environment:'production'},
  {...fixture,projectRef:'differentprojectxxxx'},
  {...fixture,supabaseUrl:'https://differentprojectxxxx.supabase.co'},
  {...fixture,supabaseUrl:`http://${ref}.supabase.co`},
  {...fixture,directUrl:'postgresql://postgres:fixture-password@localhost:5432/postgres'},
  {...fixture,directUrl:'postgresql://postgres.differentprojectxxxx:fixture-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'},
  {...fixture,directUrl:`postgresql://postgres.${ref}:fixture-password@attacker.invalid:5432/postgres`},
  {...fixture,directUrl:`${fixture.directUrl}?host=attacker.invalid`},
  {...fixture,directUrl:`${fixture.directUrl}?user=another-project`},
  {...fixture,directUrl:`${fixture.directUrl}?database=another-database`},
 ])('rejects a missing or mismatched development target',target=>{
  expect(()=>assertDevelopmentTarget(target,ref)).toThrow('DEVELOPMENT_TARGET_MISMATCH');
 });
});
