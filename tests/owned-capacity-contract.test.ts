import {describe,expect,it} from 'vitest';
import {
  CAPACITY_TARGETS,
  CAPACITY_REQUIRED_FAULTS,
  CAPACITY_SCENARIOS,
  assertControlledCapacityTransports,
  assertOwnedCapacityDatabaseName,
  deriveDrainBudgetMs,
  evaluateCapacityAcceptance,
  summarizeLatencySamples,
} from '../scripts/qa/owned-capacity-contract';

describe('owned capacity harness contract',()=>{
  it('accepts only a uniquely named structured-schema replay database',()=>{
    expect(()=>assertOwnedCapacityDatabaseName('yru_structured_schema_012345abcdef')).not.toThrow();
    for(const name of ['postgres','yru_v1_replay_012345abcdef','yru_structured_schema_0123456789','yru_structured_schema_012345abcdeg']){
      expect(()=>assertOwnedCapacityDatabaseName(name)).toThrow('OWNED_CAPACITY_DATABASE_REQUIRED');
    }
  });

  it('locks the load shapes, repetition count, and acknowledgement targets to the handoff',()=>{
    expect(CAPACITY_TARGETS).toEqual({
      acknowledgementP95Ms:1000,
      acknowledgementP99Ms:2000,
      repetitions:3,
      scenarios:[
        {id:'A',students:10,arrivalWindowMs:1000},
        {id:'B',students:100,arrivalWindowMs:5000},
        {id:'C',students:500,arrivalWindowMs:10000},
      ],
    });
    expect(CAPACITY_SCENARIOS).toEqual(['A','B','C','D','E','F','G','H','I','J']);
  });

  it('rejects any load setup without loopback ingress and controlled AI and LINE transports',()=>{
    expect(()=>assertControlledCapacityTransports({ingressOrigin:'http://127.0.0.1:4312',model:'IN_MEMORY_CONTROLLED',line:'CONTROLLED_FETCH'})).not.toThrow();
    expect(()=>assertControlledCapacityTransports({ingressOrigin:'https://public.example',model:'IN_MEMORY_CONTROLLED',line:'CONTROLLED_FETCH'})).toThrow('CONTROLLED_TRANSPORTS_REQUIRED');
    expect(()=>assertControlledCapacityTransports({ingressOrigin:'http://127.0.0.1:4312',model:'LIVE_PROVIDER',line:'CONTROLLED_FETCH'})).toThrow('CONTROLLED_TRANSPORTS_REQUIRED');
    expect(()=>assertControlledCapacityTransports({ingressOrigin:'http://127.0.0.1:4312',model:'IN_MEMORY_CONTROLLED',line:'LIVE_LINE'})).toThrow('CONTROLLED_TRANSPORTS_REQUIRED');
  });

  it('derives a finite drain deadline from observed pilot service capacity',()=>{
    expect(deriveDrainBudgetMs({targetEvents:500,pilotCompletedEvents:10,pilotDrainMs:2000})).toBe(155000);
    expect(()=>deriveDrainBudgetMs({targetEvents:500,pilotCompletedEvents:0,pilotDrainMs:2000})).toThrow('VALID_PILOT_REQUIRED');
    expect(()=>deriveDrainBudgetMs({targetEvents:500,pilotCompletedEvents:10,pilotDrainMs:Number.POSITIVE_INFINITY})).toThrow('VALID_PILOT_REQUIRED');
    expect(()=>deriveDrainBudgetMs({targetEvents:5000,pilotCompletedEvents:1,pilotDrainMs:115})).toThrow('DRAIN_BUDGET_EXCEEDS_LIMIT');
  });

  it('summarizes ACK samples with p50, p95, and p99 without dropping the tail',()=>{
    const summary=summarizeLatencySamples(Array.from({length:100},(_,index)=>index+1));
    expect(summary).toEqual({count:100,minMs:1,p50Ms:50,p95Ms:95,p99Ms:99,maxMs:100});
    expect(()=>summarizeLatencySamples([])).toThrow('LATENCY_SAMPLES_REQUIRED');
  });

  it('never reports whole capacity PASS while a scenario or mandatory fault is missing',()=>{
    const scenarios=Object.fromEntries(CAPACITY_SCENARIOS.map(id=>[id,'PASS']));
    const faults=Object.fromEntries(CAPACITY_REQUIRED_FAULTS.map(id=>[id,'PASS']));
    expect(evaluateCapacityAcceptance(scenarios,faults)).toBe('PASS');
    expect(evaluateCapacityAcceptance({...scenarios,H:'NOT_IMPLEMENTED'},faults)).toBe('PARTIAL');
    expect(evaluateCapacityAcceptance(scenarios,{...faults,ambiguous_reply:'NOT_IMPLEMENTED'})).toBe('PARTIAL');
    expect(evaluateCapacityAcceptance({...scenarios,wrong:'PASS'},faults)).toBe('PARTIAL');
  });
});
