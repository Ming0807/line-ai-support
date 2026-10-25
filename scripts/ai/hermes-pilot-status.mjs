const phases=new Set([
 'CONFIGURATION','PRIVATE_HOME','DATABASE_CONNECT','DATABASE_READY','BRIDGE_START','BRIDGE_READY',
 'HERMES_RUNTIME_CONFIG','INTERPRETER_DISCOVERY','INTERPRETER_ACTIVATION','INTERPRETER_READY',
 'AGENT_RUNNING','BEFORE_IMPORT','AFTER_IMPORT','AGENT_INIT','AGENT_READY','TURN_1_START','TURN_1_DONE',
 'TURN_2_START','TURN_2_DONE','AGENT_EXITED','COMPLETE',
]);

export function formatPilotStatus(status,phase,turns){
 if(!['RUNNING','PASS','FAIL'].includes(status)||!phases.has(phase)||
  (turns!==undefined&&(!Number.isInteger(turns)||turns<0||turns>2)))throw new Error('PILOT_STATUS_INVALID');
 return JSON.stringify({pilot:'HERMES_SYNTHETIC',status,phase,...(turns===undefined?{}:{turns})});
}

export function parsePilotStatusLine(line){
 const prefix='HERMES_STATUS=';
 if(typeof line!=='string'||!line.startsWith(prefix))return null;
 try{
  const value=JSON.parse(line.slice(prefix.length));
  const normalized=formatPilotStatus(value.status,value.phase,value.turns);
  return normalized===JSON.stringify(value)?value:null;
 }catch{return null;}
}
