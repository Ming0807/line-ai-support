import 'dotenv/config';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {databaseConnection} from '../../lib/database/connection';
import {assertDevelopmentTarget} from '../../lib/database/development-target';
import {provisionOriginalStorage,ORIGINAL_BUCKET} from '../../lib/imports/original-storage';
const expectedRef='tqgbodenouvcwepoxwbu';
let database:Client|undefined;
try{
 assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},expectedRef);
 if(process.argv.slice(2).some(argument=>argument!=='--provision'))throw new Error();
 database=new Client(databaseConnection(process.env.DIRECT_URL!));await database.connect();
 // Do not silently rewrite university Storage rules added after this DEVELOPMENT checkpoint.
 const policies=await database.query("select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects'");
 if(policies.rows[0].n!==0)throw new Error();
 const provision=process.argv.includes('--provision');if(provision)await provisionOriginalStorage();
 const client=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
 const {data,error}=await client.storage.getBucket(ORIGINAL_BUCKET);
 const missing=error!==null&&'statusCode' in error&&error.statusCode==='404';
 if(error&&!missing||provision&&missing||data&&(data.public!==false||data.file_size_limit!==20*1024*1024+33||JSON.stringify(data.allowed_mime_types)!=='["application/octet-stream"]'))throw new Error();
 console.log(JSON.stringify({status:'PASS',target:'DEVELOPMENT',mode:provision?'PROVISION':'INSPECT',bucket:ORIGINAL_BUCKET,bucketPresent:!!data,bucketPrivate:data?.public===false,objectPolicies:0,existingBucketOverwritten:false,originalsDeleted:false}));
}catch{console.error('DEVELOPMENT_ORIGINAL_STORAGE_SETUP_FAILED');process.exitCode=1;}
finally{await database?.end();}
