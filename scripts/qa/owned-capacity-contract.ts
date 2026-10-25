export const CAPACITY_TARGETS={
  acknowledgementP95Ms:1000,
  acknowledgementP99Ms:2000,
  repetitions:3,
  scenarios:[
    {id:'A',students:10,arrivalWindowMs:1000},
    {id:'B',students:100,arrivalWindowMs:5000},
    {id:'C',students:500,arrivalWindowMs:10000},
  ],
} as const;

export const CAPACITY_SCENARIOS=['A','B','C','D','E','F','G','H','I','J'] as const;
export const CAPACITY_REQUIRED_FAULTS=[
  'worker_crash_after_commit_before_ack',
  'lease_expiry_recovery',
  'outbox_crash_after_http',
  'database_unavailable_before_persist',
  'restart_during_retry',
  'close_during_dispatch',
  'reassign_during_dispatch',
  'unlink_during_dispatch',
  'department_scope_change_during_dispatch',
  'sensitivity_change_during_dispatch',
  'revoked_staff',
  'stale_forged_cross_user_postback',
  'expired_reply_token',
  'unicode_multi_packet_partial_failure',
  'unsupported_media_group_room',
  'secret_redacted_logs',
  'incident_recipient_exclusion',
  'concurrent_publication_stale_evidence',
  'held_session_lock_fairness',
] as const;

const DRAIN_SAFETY_MULTIPLIER=1.5;
const DRAIN_RESERVE_MS=5000;
const MAX_DRAIN_BUDGET_MS=10*60*1000;

export function assertOwnedCapacityDatabaseName(value:unknown):asserts value is string {
  if(typeof value!=='string'||!/^yru_structured_schema_[a-f0-9]{12}$/u.test(value)){
    throw new Error('OWNED_CAPACITY_DATABASE_REQUIRED');
  }
}

export function assertControlledCapacityTransports(input:{ingressOrigin:string;model:string;line:string}):void {
  let origin:URL;
  try{origin=new URL(input.ingressOrigin);}catch{throw new Error('CONTROLLED_TRANSPORTS_REQUIRED');}
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.username||origin.password||
    input.model!=='IN_MEMORY_CONTROLLED'||input.line!=='CONTROLLED_FETCH'){
    throw new Error('CONTROLLED_TRANSPORTS_REQUIRED');
  }
}

export function deriveDrainBudgetMs(input:{targetEvents:number;pilotCompletedEvents:number;pilotDrainMs:number}):number {
  const {targetEvents,pilotCompletedEvents,pilotDrainMs}=input;
  if(!Number.isSafeInteger(targetEvents)||targetEvents<1||!Number.isSafeInteger(pilotCompletedEvents)||pilotCompletedEvents<1||
    !Number.isFinite(pilotDrainMs)||pilotDrainMs<=0){
    throw new Error('VALID_PILOT_REQUIRED');
  }
  const estimate=Math.ceil(targetEvents/pilotCompletedEvents*pilotDrainMs*DRAIN_SAFETY_MULTIPLIER+DRAIN_RESERVE_MS);
  if(!Number.isSafeInteger(estimate)||estimate>MAX_DRAIN_BUDGET_MS)throw new Error('DRAIN_BUDGET_EXCEEDS_LIMIT');
  return estimate;
}

function percentile(sorted:number[],quantile:number):number {
  return sorted[Math.max(0,Math.ceil(quantile*sorted.length)-1)];
}

export function summarizeLatencySamples(samples:readonly number[]):{
  count:number;minMs:number;p50Ms:number;p95Ms:number;p99Ms:number;maxMs:number;
} {
  if(samples.length===0||samples.some(value=>!Number.isFinite(value)||value<0))throw new Error('LATENCY_SAMPLES_REQUIRED');
  const sorted=[...samples].sort((a,b)=>a-b);
  return {count:sorted.length,minMs:sorted[0],p50Ms:percentile(sorted,.5),p95Ms:percentile(sorted,.95),
    p99Ms:percentile(sorted,.99),maxMs:sorted.at(-1)!};
}

export function evaluateCapacityAcceptance(
  scenarios:Readonly<Record<string,string>>,
  faults:Readonly<Record<string,string>>,
):'PASS'|'PARTIAL'|'FAIL' {
  const scenarioKeys=Object.keys(scenarios).sort();
  const faultKeys=Object.keys(faults).sort();
  const expectedScenarios=[...CAPACITY_SCENARIOS].sort();
  const expectedFaults=[...CAPACITY_REQUIRED_FAULTS].sort();
  const exactCoverage=scenarioKeys.length===expectedScenarios.length&&scenarioKeys.every((key,index)=>key===expectedScenarios[index])&&
    faultKeys.length===expectedFaults.length&&faultKeys.every((key,index)=>key===expectedFaults[index]);
  if(Object.values(scenarios).includes('FAIL')||Object.values(faults).includes('FAIL'))return 'FAIL';
  if(exactCoverage&&Object.values(scenarios).every(status=>status==='PASS')&&Object.values(faults).every(status=>status==='PASS'))return 'PASS';
  return 'PARTIAL';
}
