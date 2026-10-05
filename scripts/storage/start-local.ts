import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// CLI start may print keys on completion. Emit only fixed lifecycle status.
const pnpm=resolve(process.env.APPDATA??'','npm/node_modules/pnpm/bin/pnpm.cjs');
const root=fileURLToPath(new URL('../..',import.meta.url));
async function cli(args:string[]):Promise<void>{
 await new Promise<void>((accept,reject)=>{
  const child=spawn(process.execPath,[pnpm,'dlx','supabase@2.119.0',...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();child.once('error',()=>reject(new Error('LOCAL_STORAGE_SERVICES_START_FAILED')));
  child.once('close',code=>code===0?accept():reject(new Error('LOCAL_STORAGE_SERVICES_START_FAILED')));
 });
}
try{
 if(resolve(process.cwd())!==resolve(root))throw new Error();
 const names=execFileSync('docker',['ps','--format','{{.Names}}'],{encoding:'utf8',windowsHide:true,timeout:10_000}).trim().split(/\r?\n/);
 if(names.includes('supabase_db_line-ai-yru')&&!names.includes('supabase_storage_line-ai-yru')){
  // CLI start exits early for an already-running database-only stack. Preserve its data first.
  const before=execFileSync('docker',['exec','supabase_db_line-ai-yru','psql','-U','postgres','-d','postgres','-At','-c','select count(*) from supabase_migrations.schema_migrations;'],{encoding:'utf8',windowsHide:true,timeout:10_000}).trim();
  const dump=execFileSync('docker',['exec','supabase_db_line-ai-yru','pg_dump','-U','supabase_admin','-d','postgres','-Fc'],{windowsHide:true,timeout:60_000,maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
  if(dump.length<100||!/^\d+$/.test(before))throw new Error();
  const directory=resolve(root,'.superpowers/staging');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,`local-before-storage-${randomUUID()}.dump`),dump,{flag:'wx'});
  console.log('LOCAL_STORAGE_DATABASE_BACKUP_READY',{bytes:dump.length,sha256:createHash('sha256').update(dump).digest('hex'),migrations:Number(before)});
  // No --no-backup: CLI keeps data volumes. Only this project's stack is stopped.
  await cli(['stop','--project-id','line-ai-yru']);
  await cli(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  const after=execFileSync('docker',['exec','supabase_db_line-ai-yru','psql','-U','postgres','-d','postgres','-At','-c','select count(*) from supabase_migrations.schema_migrations;'],{encoding:'utf8',windowsHide:true,timeout:10_000}).trim();
  if(after!==before)throw new Error();
 }else await cli(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
 const active=execFileSync('docker',['ps','--format','{{.Names}}'],{encoding:'utf8',windowsHide:true,timeout:10_000}).trim().split(/\r?\n/);
 if(!['supabase_db_line-ai-yru','supabase_storage_line-ai-yru','supabase_auth_line-ai-yru','supabase_kong_line-ai-yru'].every(name=>active.includes(name)))throw new Error();
 console.log('LOCAL_STORAGE_SERVICES_START_COMPLETE');
}catch{console.error('LOCAL_STORAGE_SERVICES_START_FAILED');process.exitCode=1;}
