import 'dotenv/config';
import {Pool} from 'pg';
import {databaseConnection} from '../../lib/database/connection';
import {assertDevelopmentTarget} from '../../lib/database/development-target';
import {seedInitialDocumentFamilies} from '../../lib/imports/family-seed';
let pool:Pool|undefined;
try{
 assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
  supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
 if(process.argv.slice(2).some(value=>value!=='--apply')||process.argv.filter(value=>value==='--apply').length>1)throw new Error('INVALID_SEED_ARGUMENT');
 const apply=process.argv.includes('--apply');pool=new Pool({...databaseConnection(process.env.DIRECT_URL!),max:1,application_name:'yru-development-family-seed'});
 const client=await pool.connect();
 try{
  await client.query(apply?'begin':'begin read only');await client.query("set local statement_timeout='5s';set local lock_timeout='3s'");
  const result=await seedInitialDocumentFamilies(client,apply);await client.query('commit');
  console.log(JSON.stringify({stage:apply?'development_families_seeded':'development_families_dry_run',...result}));
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}catch(error){
 const message=error instanceof Error?error.message:'';
 console.error(JSON.stringify({stage:'development_families_failed',code:/^[A-Z_]+$/.test(message)?message:'DATABASE_ERROR'}));process.exitCode=1;
}finally{await pool?.end();}
