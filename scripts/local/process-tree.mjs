import {spawn} from 'node:child_process';

export async function forceStopOwnedTree(child,platform=process.platform){
 if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
 if(platform==='win32')return new Promise((resolve,reject)=>{
  let killer;
  try{killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
  catch(error){reject(error);return;}
  killer.once('error',reject);killer.once('exit',code=>code===0?resolve():reject(new Error('OWNED_PROCESS_TREE_STOP_FAILED')));
 });
 try{process.kill(-child.pid,'SIGKILL');}
 catch(error){if(error?.code!=='ESRCH')throw error;}
}
