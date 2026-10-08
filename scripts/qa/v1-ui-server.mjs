import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const runtime=JSON.parse(await readFile('.superpowers/staging/v1-ui-qa/runtime.json','utf8'));
const target=new URL(runtime.connectionString);
assert(['postgres:','postgresql:'].includes(target.protocol)&&['127.0.0.1','localhost'].includes(target.hostname)&&target.port==='54422');
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(runtime.database)&&decodeURIComponent(target.pathname.slice(1))===runtime.database);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3012'],{
 windowsHide:true,stdio:'inherit',env:{...process.env,DATABASE_URL:runtime.connectionString,DIRECT_URL:runtime.connectionString,
 APP_BASE_URL:runtime.baseUrl,LINE_WEBHOOK_MODE:'durable',YRU_AI_ENABLED:'false'},
});
process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
child.once('error',()=>{console.error('OWNED_UI_SERVER_FAILED');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??0;});
