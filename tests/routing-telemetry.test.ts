import {expect,it,vi} from 'vitest';
import {routingLatency,routingReasons,recordRoutingObservation,type RoutingObservationInput} from '../lib/conversation/routing-telemetry';
import type {Pool} from 'pg';

const poolOf=(query:unknown)=>({query}) as unknown as Pool;

it('writes one bounded parameterized observation row without awaiting or failing the caller',()=>{
 const query=vi.fn().mockResolvedValue({rowCount:1});
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'PREFLIGHT',status:'SKIPPED',reasonCode:'CANDIDATES_OVERFLOW',candidates:13,latencyMs:1234})).not.toThrow();
 const call=query.mock.calls[0]![0] as {text:string;values:unknown[];query_timeout:number};
 expect(call.text).toContain('private.inbox_routing_observations');
 expect(call.values).toEqual([null,null,'PREFLIGHT','SKIPPED','CANDIDATES_OVERFLOW',13,1234]);
 expect(call.query_timeout).toBe(2000);
});

it('downgrades a failed telemetry write to a fixed warn instead of failing routing',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const query=vi.fn().mockRejectedValue(new Error('DBERR'));
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'DECISION',status:'SUCCESS',reasonCode:'NO_EXISTING_CONTEXT',latencyMs:5})).not.toThrow();
 await vi.waitFor(()=>expect(warn).toHaveBeenCalledWith('ROUTING_TELEMETRY_UNAVAILABLE'));
 warn.mockRestore();
});

it('isolates observation writer faults: unknown or out-of-range fields warn and drop, never throw',()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const query=vi.fn().mockResolvedValue({rowCount:1});
 // Regression guard: a DECISION route row once carried an extra field unknown to the schema and threw
 // synchronously inside the processing transaction, which rolled back and marked the event DEAD.
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'DECISION',status:'SUCCESS',reasonCode:'EXPLICIT_NEW_TOPIC',latencyMs:0,
  conversationId:'11111111-2222-3333-4444-555555555555'} as unknown as RoutingObservationInput)).not.toThrow();
 expect(query).not.toHaveBeenCalled();
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'PREFLIGHT',status:'SKIPPED',reasonCode:'bad_code',latencyMs:1})).not.toThrow();
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'THEORY',status:'SKIPPED',latencyMs:1} as unknown as RoutingObservationInput)).not.toThrow();
 expect(query).not.toHaveBeenCalled();
 expect(warn).toHaveBeenCalledWith('ROUTING_TELEMETRY_UNAVAILABLE');
 warn.mockRestore();
});
it('bounds latency inside the observation envelope',()=>{
 expect(routingLatency(Date.now()-10_000_000)).toBe(3_600_000);
 expect(routingLatency(Date.now()+5000)).toBe(0);
});

it('isolates a synchronous database submission failure',()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),query=vi.fn(()=>{throw new Error('private DB details');});
 try{
  expect(()=>recordRoutingObservation(poolOf(query),{stage:'DECISION',status:'SUCCESS',latencyMs:1})).not.toThrow();
  expect(warn).toHaveBeenCalledWith('ROUTING_TELEMETRY_UNAVAILABLE');
 }finally{warn.mockRestore();}
});
it('drops further observations while one pool submission is still pending',async()=>{
 let release:(value:unknown)=>void=()=>{};
 const query=vi.fn(()=>new Promise(resolve=>{release=resolve;})),pool=poolOf(query);
 recordRoutingObservation(pool,{stage:'PREFLIGHT',status:'SUCCESS',latencyMs:1});
 recordRoutingObservation(pool,{stage:'CLASSIFY',status:'SUCCESS',latencyMs:1});
 expect(query).toHaveBeenCalledTimes(1);release({rowCount:1});await Promise.resolve();await Promise.resolve();
 recordRoutingObservation(pool,{stage:'DECISION',status:'SUCCESS',latencyMs:1});
 expect(query).toHaveBeenCalledTimes(2);release({rowCount:1});
});

it('keeps every routing reason inside the database code shape, buckets and Thai label size',()=>{
 expect(Object.keys(routingReasons)).toContain('CANDIDATES_OVERFLOW');
 expect(Object.keys(routingReasons)).toContain('LOW_CONFIDENCE');
 for(const [code,meta] of Object.entries(routingReasons)){
  expect(code).toMatch(/^[A-Z0-9_]{1,48}$/u);
  expect(meta.label.length).toBeLessThanOrEqual(100);
  expect(['ERROR','WARN','INFO']).toContain(meta.severity);
 }
});
