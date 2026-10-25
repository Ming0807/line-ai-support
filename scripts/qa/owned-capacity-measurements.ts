import {execFile} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import type {Pool,PoolClient} from 'pg';

export const SOL06_POSTGRES_CONTAINER='supabase_db_line-ai-yru';
export const SOL06_DOCKER_SAMPLE_INTERVAL_MS=5_000;
export const SOL06_DOCKER_COMMAND_TIMEOUT_MS=10_000;

export type PoolAcquisitionSample={
  pool:string;
  durationMs:number;
  queuedAtRequest:boolean;
  outcome:'ACQUIRED'|'FAILED';
};

type PoolConnectCallback=(error:Error|undefined,client:PoolClient|undefined,release:(error?:Error|boolean)=>void)=>void;

export function instrumentPoolAcquisition(pool:Pool,name:string,maxConnections:number,samples:PoolAcquisitionSample[]):void {
  const originalConnect=pool.connect.bind(pool) as {
    ():Promise<PoolClient>;
    (callback:PoolConnectCallback):void;
  };
  const measuredConnect=((callback?:PoolConnectCallback):Promise<PoolClient>|void=>{
    const requestedAt=performance.now();
    const queuedAtRequest=pool.waitingCount>0||(pool.idleCount===0&&pool.totalCount>=maxConnections);
    const record=(outcome:PoolAcquisitionSample['outcome'])=>samples.push({pool:name,durationMs:performance.now()-requestedAt,queuedAtRequest,outcome});
    if(callback){
      return originalConnect((error,client,release)=>{
        record(error||!client?'FAILED':'ACQUIRED');
        callback(error,client,release);
      });
    }
    return originalConnect().then(client=>{
      record('ACQUIRED');return client;
    },error=>{
      record('FAILED');throw error;
    });
  }) as typeof pool.connect;
  pool.connect=measuredConnect;
}

export type PostgresContainerSample={
  sampledAtUtc:string;
  container:string;
  cpuPercent:number;
  memoryUsedBytes:number;
  memoryLimitBytes:number;
  memoryPercent:number;
};

export type PostgresContainerFailure={
  attemptedAtUtc:string;
  durationMs:number;
  reason:'DOCKER_CLI_UNAVAILABLE'|'DOCKER_STATS_TIMEOUT'|'DOCKER_STATS_COMMAND_FAILED'|'DOCKER_STATS_OUTPUT_INVALID';
};

export type PostgresContainerSnapshot={
  status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE';
  container:string;
  intervalMs:number;
  commandTimeoutMs:number;
  samples:PostgresContainerSample[];
  failures:PostgresContainerFailure[];
  overlappingSamplesSkipped:number;
};

function numberPercent(value:string):number|null {
  const match=/^\s*(\d+(?:\.\d+)?)%\s*$/u.exec(value);
  if(!match)return null;
  const result=Number(match[1]);
  return Number.isFinite(result)?result:null;
}

function memoryBytes(value:string):number|null {
  const match=/^\s*(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*$/iu.exec(value);
  if(!match)return null;
  const units:Record<string,number>={b:1,kb:1_000,mb:1_000_000,gb:1_000_000_000,tb:1_000_000_000_000,
    kib:1024,mib:1024**2,gib:1024**3,tib:1024**4};
  const multiplier=units[match[2].toLowerCase()];
  if(!multiplier)return null;
  const result=Number(match[1])*multiplier;
  return Number.isFinite(result)?Math.round(result):null;
}

function parseDockerStats(output:string,attemptedAtUtc:string):PostgresContainerSample {
  const lines=output.trim().split(/\r?\n/u).filter(Boolean);
  if(lines.length!==1)throw new Error('DOCKER_STATS_OUTPUT_INVALID');
  const [container,cpuText,memoryText,memoryPercentText]=lines[0].split('|');
  if(container!==SOL06_POSTGRES_CONTAINER||!cpuText||!memoryText||!memoryPercentText)throw new Error('DOCKER_STATS_OUTPUT_INVALID');
  const [usedText,limitText,...extra]=memoryText.split('/');
  if(extra.length)throw new Error('DOCKER_STATS_OUTPUT_INVALID');
  const cpuPercent=numberPercent(cpuText),memoryPercent=numberPercent(memoryPercentText);
  const memoryUsedBytes=memoryBytes(usedText??''),memoryLimitBytes=memoryBytes(limitText??'');
  if(cpuPercent===null||memoryPercent===null||memoryUsedBytes===null||memoryLimitBytes===null)throw new Error('DOCKER_STATS_OUTPUT_INVALID');
  return {sampledAtUtc:attemptedAtUtc,container,cpuPercent,memoryUsedBytes,memoryLimitBytes,memoryPercent};
}

function failureReason(error:unknown):PostgresContainerFailure['reason'] {
  if(error instanceof Error&&error.message==='DOCKER_STATS_OUTPUT_INVALID')return 'DOCKER_STATS_OUTPUT_INVALID';
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  if(code==='ENOENT')return 'DOCKER_CLI_UNAVAILABLE';
  if(code==='ETIMEDOUT'||error&&typeof error==='object'&&'killed' in error&&error.killed===true)return 'DOCKER_STATS_TIMEOUT';
  return 'DOCKER_STATS_COMMAND_FAILED';
}

function readContainerStats():Promise<string> {
  return new Promise((resolve,reject)=>{
    execFile('docker',['stats','--no-stream','--format','{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}',SOL06_POSTGRES_CONTAINER],
      {encoding:'utf8',timeout:SOL06_DOCKER_COMMAND_TIMEOUT_MS,windowsHide:true,maxBuffer:64*1024},(error,stdout)=>{
        if(error){reject(error);return;}
        resolve(stdout);
      });
  });
}

export function createPostgresContainerSampler():{snapshot:()=>PostgresContainerSnapshot;stop:()=>Promise<void>} {
  const samples:PostgresContainerSample[]=[],failures:PostgresContainerFailure[]=[];
  let timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,stopped=false,overlappingSamplesSkipped=0;
  const schedule=()=>{if(!stopped)timer=setTimeout(sampleNow,SOL06_DOCKER_SAMPLE_INTERVAL_MS);};
  const sampleNow=()=>{
    if(stopped)return;
    if(pending){overlappingSamplesSkipped++;return;}
    const attemptedAtUtc=new Date().toISOString(),startedAt=performance.now();
    pending=(async()=>{
      try{samples.push(parseDockerStats(await readContainerStats(),new Date().toISOString()));}
      catch(error){failures.push({attemptedAtUtc,durationMs:performance.now()-startedAt,reason:failureReason(error)});}
    })().finally(()=>{pending=undefined;schedule();});
  };
  sampleNow();
  return {
    snapshot:()=>({status:samples.length===0?'UNAVAILABLE':failures.length===0?'AVAILABLE':'PARTIAL',container:SOL06_POSTGRES_CONTAINER,
      intervalMs:SOL06_DOCKER_SAMPLE_INTERVAL_MS,commandTimeoutMs:SOL06_DOCKER_COMMAND_TIMEOUT_MS,samples:[...samples],failures:[...failures],overlappingSamplesSkipped}),
    stop:async()=>{stopped=true;if(timer)clearTimeout(timer);const active=pending;if(active)await active;},
  };
}
