import 'dotenv/config';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(path.resolve(process.cwd()),root,'WORKSPACE_ROOT_REQUIRED');
const localDatabase='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const nextCli=path.join(root,'node_modules','next','dist','bin','next');
const child=spawn(process.execPath,[nextCli,'start','--hostname','127.0.0.1','--port','3001'],{
 cwd:root,stdio:'inherit',windowsHide:true,
 env:{...process.env,DATABASE_URL:localDatabase,DIRECT_URL:localDatabase,APP_BASE_URL:'http://127.0.0.1:3001',
  LINE_WEBHOOK_MODE:'durable',YRU_AI_ENABLED:'false'},
});
process.once('SIGINT',()=>child.kill('SIGINT'));
process.once('SIGTERM',()=>child.kill('SIGTERM'));
child.once('error',()=>{console.error('LOCAL_QA_SERVER_START_FAILED');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??0;});
