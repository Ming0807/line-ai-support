import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const result=spawnSync('git',['diff','--cached','--no-ext-diff'],{encoding:'utf8',maxBuffer:20*1024*1024,windowsHide:true});
if(result.status!==0) {console.error('STAGED_DIFF_CHECK_FAILED');process.exit(1);}
const protectedValues=Object.entries(process.env).filter(([key,value])=>
 value && value.length>10 && /KEY|TOKEN|SECRET|DATABASE_URL|DIRECT_URL/.test(key)).map(([,value])=>value);
for(const key of ['DATABASE_URL','DIRECT_URL','SUPABASE_DIRECT_DATABASE_URL']) {
 if(process.env[key]) {try {protectedValues.push(decodeURIComponent(new URL(process.env[key]).password));}catch{/* no raw diagnostics */}}
}
try {
 const file=JSON.parse(readFileSync('.superpowers/staging/dev-staff-credentials.json','utf8'));
 protectedValues.push(...file.accounts.map(account=>account.password),...(file.pending?[file.pending.password]:[]));
} catch {/* Bootstrap is optional outside the development workspace. */}
const leaked=protectedValues.filter(Boolean).some(value=>result.stdout.includes(value));
console.log(leaked?'STAGED_CREDENTIAL_CHECK_FAILED':'STAGED_CREDENTIAL_CHECK_PASSED');
if(leaked) process.exitCode=1;
