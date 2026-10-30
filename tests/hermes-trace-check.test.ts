import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,it} from 'vitest';

it('fails closed when a build trace includes the cached Hermes runtime or lacks the copilot trace',()=>{
 const root=mkdtempSync(join(tmpdir(),'yru-hermes-trace-'));
 const script=resolve('scripts/security/check-hermes-traces.mjs');
 const check=()=>spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});
 try{
  expect(check().status).toBe(1);
  const folder=join(root,'.next','server','app','api','tickets','[id]','copilot');
  mkdirSync(folder,{recursive:true});const trace=join(folder,'route.js.nft.json');
  writeFileSync(trace,JSON.stringify({files:['../../scripts/ai/hermes-staff-driver.py']}));
  expect(check().status).toBe(0);
  writeFileSync(trace,JSON.stringify({files:['../../.superpowers/staging/hermes-runtime/staff-runs/private.json']}));
  expect(check().status).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
