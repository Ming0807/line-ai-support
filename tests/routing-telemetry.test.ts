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

it('rejects malformed observations synchronously so nothing degrades silently',()=>{
 const query=vi.fn();
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'PREFLIGHT',status:'SKIPPED',reasonCode:'bad_code',latencyMs:1})).toThrow('ROUTING_OBSERVATION_INVALID');
 expect(()=>recordRoutingObservation(poolOf(query),{stage:'THEORY',status:'SKIPPED',latencyMs:1} as unknown as RoutingObservationInput)).toThrow('ROUTING_OBSERVATION_INVALID');
 expect(query).not.toHaveBeenCalled();
});

it('bounds latency inside the observation envelope',()=>{
 expect(routingLatency(Date.now()-10_000_000)).toBe(3_600_000);
 expect(routingLatency(Date.now()+5000)).toBe(0);
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
