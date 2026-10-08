import 'dotenv/config';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {databaseConnection} from '../../lib/database/connection';
import {assertDevelopmentTarget} from '../../lib/database/development-target';
import {structuredInfrastructureReady} from '../../lib/knowledge/structured-readiness';
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
 supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const pool=new Pool({...databaseConnection(process.env.DIRECT_URL!),max:1});
try{
 const readiness=await structuredInfrastructureReady(pool);
 assert.equal(readiness,true);
 const counts=(await pool.query(`select (select count(*)::int from private.knowledge_import_jobs) imports,
 (select count(*)::int from private.knowledge_import_revisions) extraction_revisions,
 (select count(*)::int from private.knowledge_import_publications) publication_receipts,
 (select count(*)::int from public.documents) documents,
 (select count(*)::int from supabase_migrations.schema_migrations) migrations`)).rows[0];
 console.log(JSON.stringify({status:'PASS',developmentOnly:true,structuredAvailable:readiness,counts,sourceApprovalPerformed:false,liveProviderCalled:false}));
}catch{console.error('STRUCTURED_DEVELOPMENT_STATUS_FAILED');process.exitCode=1;}
finally{await pool.end();}
