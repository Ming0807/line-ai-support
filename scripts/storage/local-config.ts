import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {z} from 'zod';
/** Never print CLI status: it contains local API credentials. */
export function localStorageConfig():{url:string;secretKey:string;publishableKey:string}{
 try{
  const pnpm=resolve(process.env.APPDATA??'','npm/node_modules/pnpm/bin/pnpm.cjs');
  const output=execFileSync(process.execPath,[pnpm,'dlx','supabase@2.119.0','status','--output','json'],{encoding:'utf8',windowsHide:true,timeout:60_000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
  const value=z.object({API_URL:z.literal('http://127.0.0.1:54421'),SERVICE_ROLE_KEY:z.string().min(1),ANON_KEY:z.string().min(1)}).parse(JSON.parse(output));
  return {url:value.API_URL,secretKey:value.SERVICE_ROLE_KEY,publishableKey:value.ANON_KEY};
 }catch{throw new Error('LOCAL_STORAGE_CONFIGURATION_UNAVAILABLE');}
}
