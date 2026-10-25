import {describe,expect,it} from 'vitest';
import {formatPilotStatus,parsePilotStatusLine} from '../scripts/ai/hermes-pilot-status.mjs';

describe('Hermes pilot status output',()=>{
 it('contains only fixed phase and outcome metadata',()=>{
  const event=JSON.parse(formatPilotStatus('FAIL','INTERPRETER_ACTIVATION'));
  expect(event).toEqual({pilot:'HERMES_SYNTHETIC',status:'FAIL',phase:'INTERPRETER_ACTIVATION'});
  expect(JSON.stringify(event)).not.toMatch(/answer|token|secret|provider|quota/i);
 });
 it('allows a completed two-turn count without exposing reply text',()=>{
  expect(formatPilotStatus('PASS','COMPLETE',2)).toBe('{"pilot":"HERMES_SYNTHETIC","status":"PASS","phase":"COMPLETE","turns":2}');
 });
 it('parses only the fixed safe status format',()=>{
  expect(parsePilotStatusLine('HERMES_STATUS={"pilot":"HERMES_SYNTHETIC","status":"RUNNING","phase":"AGENT_RUNNING"}')).toEqual({pilot:'HERMES_SYNTHETIC',status:'RUNNING',phase:'AGENT_RUNNING'});
  expect(parsePilotStatusLine('HERMES_STATUS={"pilot":"HERMES_SYNTHETIC","status":"FAIL","phase":"COMPLETE","answer":"private"}')).toBeNull();
  expect(parsePilotStatusLine('provider says quota exhausted')).toBeNull();
 });
 it('accepts only explicit Python runtime progress phases',()=>{
  expect(formatPilotStatus('RUNNING','BEFORE_IMPORT')).toContain('BEFORE_IMPORT');
  expect(()=>formatPilotStatus('RUNNING','RUNNING arbitrary output')).toThrow('PILOT_STATUS_INVALID');
 });
 it.each([['PASS','UNKNOWN'],['FAIL','AGENT_RUNNING',3],['MAYBE','COMPLETE']])('rejects invalid metadata %j',(...values)=>{
  expect(()=>formatPilotStatus(values[0] as string,values[1] as string,values[2] as number|undefined)).toThrow('PILOT_STATUS_INVALID');
 });
});
