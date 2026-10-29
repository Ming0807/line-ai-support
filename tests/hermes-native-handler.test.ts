import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {afterEach,describe,expect,it} from 'vitest';
import {startHermesPilotBridge} from '../lib/ai/hermes-pilot-bridge';

const runFile=promisify(execFile);
const toolName='search_yru_knowledge';
const query='synthetic native-handler query';
const reply='Synthetic grounded staff draft';
const advice={status:'VERIFIED',answer:'Synthetic verified advice',sources:[]};
const driverPath=resolve('scripts/ai/hermes-staff-driver.py');
const cachedPython=resolve('.superpowers/staging/hermes-runtime/python/cpython-3.14.7-windows-x86_64-none/python.exe');
const pythonAvailable=existsSync(cachedPython);
const activeHarnesses:Array<()=>Promise<void>>=[];

type DispatchTrace={argumentType:string;argumentKeys:string[];errorCode:string|null;returnedSyntheticAdvice:boolean};
type DriverHarness={
 run:()=>Promise<{exitCode:number|null;stdout:string;stderr:string}>;
 readTrace:()=>Promise<DispatchTrace[]>;
 close:()=>Promise<void>;
 lookupQueries:string[];
 decisionCount:()=>number;
};

const registrySource=`import inspect

class Registry:
    def __init__(self):
        self.handler = None
        self.events = []

    def register(self, *, name, toolset, schema, handler, description):
        self.handler = handler

    def dispatch(self, name, args, **kwargs):
        handler = self.handler
        parameters = inspect.signature(handler).parameters
        accepts_context = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in parameters.values())
        forwarded = kwargs if accepts_context else {key: value for key, value in kwargs.items() if key in parameters}
        try:
            result = handler(args, **forwarded)
            error_code = None
        except Exception as error:
            error_code = str(error) if str(error) in {
                "TOOL_QUERY_INVALID", "BRIDGE_TOKEN_INVALID", "BRIDGE_ENDPOINT_INVALID"
            } else type(error).__name__
            result = {"error": type(error).__name__ + ": " + str(error)}
        argument_keys = sorted(args.keys()) if isinstance(args, dict) else []
        self.events.append({
            "argumentType": type(args).__name__,
            "argumentKeys": argument_keys,
            "errorCode": error_code,
            "returnedSyntheticAdvice": isinstance(result, dict) and result.get("answer") == "Synthetic verified advice",
        })
        return result

registry = Registry()
`;

const runAgentSource=`import json
import os
import urllib.request
from pathlib import Path
from tools.registry import registry

TOOL_NAME = "search_yru_knowledge"
TRACE_PATH = Path(os.environ["HERMES_HOME"]) / "controlled-registry-trace.json"

def record_trace():
    TRACE_PATH.write_text(json.dumps(registry.events), encoding="utf-8")

def post(url, payload, token):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"authorization": "Bearer " + token, "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def completion_request(messages):
    return {
        "model": "yru-free-pilot",
        "messages": messages,
        "stream": False,
        "tools": [{"type": "function", "function": {
            "name": TOOL_NAME,
            "description": "Read-only synthetic fixture tool",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}},
                           "required": ["query"], "additionalProperties": False},
        }}],
    }

class AIAgent:
    def __init__(self, *, model, provider, api_mode, base_url, api_key, enabled_toolsets, **kwargs):
        self.base_url = base_url
        self.api_key = api_key
        self.tools = [{"name": TOOL_NAME}]

    def run_conversation(self, *, user_message):
        scenario_path = Path(os.environ["YRU_HERMES_SOURCE"]) / "scenario.json"
        scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario["mode"] == "invalid_args":
            for args in scenario["arguments"]:
                registry.dispatch(TOOL_NAME, args, task_id="synthetic-task", session_id="synthetic-session")
            record_trace()
            return {"completed": True, "failed": False, "final_response": "Synthetic fixture draft"}

        messages = [{"role": "system", "content": "Controlled fixture system message"},
                    {"role": "user", "content": user_message}]
        first = post(self.base_url + "/chat/completions", completion_request(messages), self.api_key)
        first_message = first["choices"][0]["message"]
        calls = first_message.get("tool_calls") or []
        if len(calls) != 1 or calls[0]["function"]["name"] != TOOL_NAME:
            raise ValueError("FIXTURE_TOOL_CALL_INVALID")
        call = calls[0]
        arguments = json.loads(call["function"]["arguments"])
        tool_result = registry.dispatch(TOOL_NAME, arguments, task_id="synthetic-task", session_id="synthetic-session")
        record_trace()
        messages.extend([
            {"role": "assistant", "content": None, "tool_calls": [call]},
            {"role": "tool", "tool_call_id": call["id"], "name": TOOL_NAME,
             "content": json.dumps(tool_result, ensure_ascii=False)},
        ])
        second = post(self.base_url + "/chat/completions", completion_request(messages), self.api_key)
        final = second["choices"][0]["message"].get("content")
        if not isinstance(final, str) or not final.strip():
            raise ValueError("FIXTURE_FINAL_REPLY_INVALID")
        return {"completed": True, "failed": False, "final_response": final}

    def close(self):
        return None
`;

async function createDriverHarness(mode:'valid_tool'|'invalid_args',toolArguments:unknown[]=[]):Promise<DriverHarness>{
 const root=await mkdtemp(join(tmpdir(),'yru-hermes-native-handler-'));
 const source=join(root,'hermes-agent');
 const home=join(root,'home');
 const callsPath=join(root,'request.json');
 const scenarioPath=join(source,'scenario.json');
 await mkdir(join(source,'tools'),{recursive:true});
 await mkdir(home,{recursive:true});
 await writeFile(join(source,'tools','__init__.py'),'\n',{encoding:'utf8'});
 await writeFile(join(source,'tools','registry.py'),registrySource,{encoding:'utf8'});
 await writeFile(join(source,'toolsets.py'),'def create_custom_toolset(name, description, tools):\n    return None\n',{encoding:'utf8'});
 await writeFile(join(source,'run_agent.py'),runAgentSource,{encoding:'utf8'});
 await writeFile(scenarioPath,JSON.stringify({mode:mode==='invalid_args'?'invalid_args':'valid_tool',arguments:toolArguments}),{encoding:'utf8'});
 await writeFile(callsPath,JSON.stringify({question:'Synthetic offline staff question'}),{encoding:'utf8'});

 const token=randomBytes(32).toString('hex');
 const lookupQueries:string[]=[];
 let decisions=0;
 const bridge=await startHermesPilotBridge({token,maxRequests:4,timeoutMs:5000,reply:async()=>reply,toolSupport:{
  description:'Synthetic offline read-only knowledge fixture',
  parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},
  maxToolCalls:1,
  execute:async({query:actualQuery})=>{lookupQueries.push(actualQuery);return advice;},
  reply:async()=>{
   decisions++;
   if(decisions===1)return {toolCalls:[{id:'native-handler-fixture-call',name:toolName,arguments:{query}}]};
   if(decisions===2&&lookupQueries.length===1)return {content:reply};
   throw new Error('CONTROLLED_PROTOCOL_ORDER_INVALID');
  },
 }});

 const environment:NodeJS.ProcessEnv={NODE_ENV:'test'};
 for(const name of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'] as const){
  const value=process.env[name];if(value)environment[name]=value;
 }
 Object.assign(environment,{HERMES_HOME:home,HERMES_DISABLE_LAZY_INSTALLS:'1',YRU_HERMES_SOURCE:source,
  YRU_HERMES_INPUT_PATH:callsPath,YRU_HERMES_BRIDGE_URL:bridge.url,YRU_HERMES_BRIDGE_TOKEN:token,
  YRU_HERMES_TOOL_URL:bridge.toolUrl!,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});

 let closed=false;
 const close=async()=>{
  if(closed)return;closed=true;
  await bridge.close();
  await rm(root,{recursive:true,force:true});
 };
 activeHarnesses.push(close);
 return {
  run:async()=>{
   try{
    const result=await runFile(cachedPython,[driverPath],{cwd:process.cwd(),env:environment,windowsHide:true,timeout:15000,encoding:'utf8'});
    return {exitCode:0,stdout:result.stdout,stderr:result.stderr};
   }catch(error){
    const failure=error as NodeJS.ErrnoException&{stdout?:string;stderr?:string};
    return {exitCode:typeof failure.code==='number'?failure.code:null,stdout:failure.stdout??'',stderr:failure.stderr??''};
   }
  },
  readTrace:async()=>JSON.parse(await readFile(join(home,'controlled-registry-trace.json'),'utf8')) as DispatchTrace[],
  close,
  lookupQueries,
  decisionCount:()=>decisions,
 };
}

afterEach(async()=>{
 const cleanup=activeHarnesses.splice(0);
 await Promise.all(cleanup.map(close=>close()));
});

describe.skipIf(!pythonAvailable)('native Hermes Python tool handler contract',()=>{
 it('dispatches the dictionary tool arguments to the authenticated bridge and returns a draft',async()=>{
  const harness=await createDriverHarness('valid_tool');
  try{
   const result=await harness.run();
   const trace=await harness.readTrace();
   expect(trace).toEqual([{argumentType:'dict',argumentKeys:['query'],errorCode:null,returnedSyntheticAdvice:true}]);
   expect(harness.lookupQueries).toEqual([query]);
   expect(harness.decisionCount()).toBe(2);
   expect(result.exitCode).toBe(0);
   expect(result.stdout).toContain('YRU_HERMES_STAFF_COMPLETE=');
  }finally{await harness.close();}
 });

 it('rejects non-dictionary, missing, empty, and extra-key arguments before the bridge',async()=>{
  const harness=await createDriverHarness('invalid_args',[
   query,
   null,
   {},
   {query:''},
   {query,extra:'unexpected'},
  ]);
  try{
   const result=await harness.run();
   const trace=await harness.readTrace();
   expect(harness.lookupQueries).toEqual([]);
   expect(trace.map(event=>event.errorCode)).toEqual(Array(5).fill('TOOL_QUERY_INVALID'));
   expect(harness.decisionCount()).toBe(0);
   expect(result.exitCode).toBe(0);
  }finally{await harness.close();}
 });
});
