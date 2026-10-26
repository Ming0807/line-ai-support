const phases=new Set([
 'CONFIGURATION','PRIVATE_HOME','DATABASE_CONNECT','SNAPSHOT_AUTHORIZATION','MODEL_PIN','BRIDGE_START',
 'INTERPRETER_BOOTSTRAP','AGENT_RUNNING','BEFORE_IMPORT','AFTER_IMPORT','REGISTER_TOOL','AGENT_INIT','AGENT_READY',
 'TURN_1_START','TURN_1_DONE','AGENT_EXITED','COMPLETE',
]);

export function formatCopilotStatus(status,phase,turns,verifiedSourceToolUsed=false){
 if(!['RUNNING','PASS','FAIL'].includes(status)||!phases.has(phase)||
  (turns!==undefined&&(!Number.isInteger(turns)||turns<0||turns>1))||typeof verifiedSourceToolUsed!=='boolean'||
  (status==='PASS'&&(phase!=='COMPLETE'||turns!==1||verifiedSourceToolUsed!==true)))throw new Error('PILOT_STATUS_INVALID');
 return JSON.stringify({pilot:'HERMES_COPILOT',status,phase,classification:'PROTOTYPE_SMOKE_ONLY',contentReview:'UNREVIEWED',
  verifiedSourceToolUsed,...(turns===undefined?{}:{turns})});
}

export function formatCopilotFailure(error){
 // Never include child stdout/stderr, provider responses, or exception text in pilot diagnostics.
 void error;
 return 'HERMES_PILOT_FAILED';
}

export function canMarkCopilotSmokePass(input){
 return input!==null&&typeof input==='object'&&input.exitCode===0&&input.turns===1&&
  input.verifiedSourceToolUsed===true&&input.oversized===false&&input.timedOut===false;
}

export function parseCopilotStatusLine(line){
 const prefix='HERMES_STATUS=';
 if(typeof line!=='string'||!line.startsWith(prefix))return null;
 try{
  const value=JSON.parse(line.slice(prefix.length));
  const normalized=formatCopilotStatus(value.status,value.phase,value.turns,value.verifiedSourceToolUsed);
  return normalized===JSON.stringify(value)?value:null;
 }catch{return null;}
}
