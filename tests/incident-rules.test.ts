import {describe,expect,it} from 'vitest';
import {detectIncidentCandidate,canExtendIncident} from '../lib/incidents/detector';
import {cosineSimilarity} from '../lib/incidents/similarity';
import {incidentConfigSchema,ticketDescriptorSchema} from '../lib/incidents/contracts';
import {deriveIncidentSeverity,canTransitionIncident} from '../lib/incidents/severity';
import {INCIDENT_NOW,incidentConfig,ticketDescriptor,unitVector} from './fixtures/incident-rules';
describe('scoped semantic incident rules',()=>{
 it('groups five independent reports under the configurable default',()=>{
  const tickets=Array.from({length:5},(_,i)=>ticketDescriptor(i+1));const result=detectIncidentCandidate(tickets[0],tickets,INCIDENT_NOW);
  expect(result?.reportCount).toBe(5);expect(result?.distinctSessionCount).toBe(5);expect(result?.severity).toBe('HIGH');
  expect(result?.members).toHaveLength(5);expect(JSON.stringify(result)).not.toContain('private-session-key');
 });
 it('one anonymous session cannot meet independent-reporter thresholds',()=>{
  const tickets=Array.from({length:9},(_,i)=>ticketDescriptor(i+1,{anonymousSessionKey:'same-private-session'}));
  expect(detectIncidentCandidate(tickets[0],tickets,INCIDENT_NOW)).toBeNull();
 });
 it('duplicates never inflate report count and conflicting duplicate revisions fail closed',()=>{
  const t=ticketDescriptor(1);expect(detectIncidentCandidate(t,Array(8).fill(t),INCIDENT_NOW)).toBeNull();
  expect(()=>detectIncidentCandidate(t,[t,ticketDescriptor(1,{revision:2})],INCIDENT_NOW)).toThrow('INCIDENT_INPUT_INVALID');
 });
 it('canonical UUID spellings never count one ticket twice',()=>{
  const a=ticketDescriptor(10),b={...a,id:a.id.toUpperCase(),departmentId:a.departmentId.toUpperCase()};
  expect(detectIncidentCandidate(a,[b],INCIDENT_NOW,incidentConfig())).toBeNull();
 });
 it('extensions check old membership outside the rolling window and fail on conflicting context or semantic bridges',()=>{
  const old=ticketDescriptor(1,{createdAt:'2026-10-07T00:00:00.000Z',locationCode:'BUILDING_A'});
  const recent=ticketDescriptor(2,{locationCode:null});
  const conflict=ticketDescriptor(3,{locationCode:'BUILDING_B'});
  expect(canExtendIncident([old],[recent,conflict],.85)).toBe(false);
  expect(canExtendIncident([old],[recent],.85)).toBe(true);
  expect(canExtendIncident([old],[ticketDescriptor(4,{vector:unitVector(60)})],.85)).toBe(false);
  expect(canExtendIncident([],[],.85)).toBe(false);
 });
 it.each([
  {departmentId:'22222222-2222-4222-8222-222222222222'}, {category:'OTHER'},
  {systemCode:'DIFFERENT_SYSTEM'}, {locationCode:'OTHER_BUILDING'},
  {createdAt:'2026-10-07T23:59:59.999Z'}, {createdAt:'2026-10-08T00:15:00.001Z'},
  {status:'CLOSED'}, {status:'RESOLVED'}, {vector:unitVector(60)},
 ])('rejects conflicting/ineligible context %j',overrides=>{
  const anchor=ticketDescriptor(1),other=ticketDescriptor(2,overrides);
  expect(detectIncidentCandidate(anchor,[anchor,other],INCIDENT_NOW,incidentConfig())).toBeNull();
 });
 it('inclusive window endpoints and unknown optional context remain explicit',()=>{
  const anchor=ticketDescriptor(1,{systemCode:null,locationCode:null,createdAt:'2026-10-08T00:00:00.000Z'});
  const other=ticketDescriptor(2,{createdAt:INCIDENT_NOW,sensitivity:'RESTRICTED'});
  expect(detectIncidentCandidate(anchor,[anchor,other],INCIDENT_NOW,incidentConfig())?.maxSensitivity).toBe('RESTRICTED');
 });
 it('pairwise checks prevent a similar hub bridging mutually dissimilar reports',()=>{
  const anchor=ticketDescriptor(1),left=ticketDescriptor(2,{vector:unitVector(-25)}),right=ticketDescriptor(3,{vector:unitVector(25)});
  expect(detectIncidentCandidate(anchor,[anchor,left,right],INCIDENT_NOW,incidentConfig({minReports:3,minDistinctSessions:3}))).toBeNull();
 });
 it('explicit rules can require more reports than distinct sessions',()=>{
  const a=ticketDescriptor(1),b=ticketDescriptor(2),c=ticketDescriptor(3,{anonymousSessionKey:a.anonymousSessionKey});
  expect(detectIncidentCandidate(a,[a,b,c],INCIDENT_NOW,incidentConfig({minReports:3,minDistinctSessions:2}))?.reportCount).toBe(3);
 });
 it('rejects bad rules, nonunit/nonfinite/wrong-size vectors and invented descriptor fields',()=>{
  for(const config of [incidentConfig({minReports:1}),incidentConfig({minDistinctSessions:3}),incidentConfig({windowMinutes:0}),incidentConfig({minSimilarity:1.1})])expect(incidentConfigSchema.safeParse(config).success).toBe(false);
  for(const vector of [Array(384).fill(0),[1,0],Array(384).fill(Infinity),Array(384).fill(.1)])expect(ticketDescriptorSchema.safeParse(ticketDescriptor(1,{vector})).success).toBe(false);
  expect(ticketDescriptorSchema.safeParse(ticketDescriptor(1,{rawLineId:'private'})).success).toBe(false);
  expect(cosineSimilarity(unitVector(),unitVector(60))).toBeCloseTo(.5);
 });
 it('AI priority alone cannot authorize a critical aggregate',()=>{
  expect(deriveIncidentSeverity(5)).toBe('HIGH');
  expect(deriveIncidentSeverity(1)).toBe('MEDIUM');
  expect(deriveIncidentSeverity(5,{campusWide:true,criticalService:true,confirmedOutage:false})).toBe('HIGH');
  expect(deriveIncidentSeverity(5,{campusWide:true,criticalService:true,confirmedOutage:true})).toBe('CRITICAL');
 });
 it('staff incident transitions never close linked tickets implicitly',()=>{
  expect(canTransitionIncident('DETECTED','INVESTIGATING')).toBe(true);
  expect(canTransitionIncident('INVESTIGATING','MONITORING')).toBe(true);
  expect(canTransitionIncident('MONITORING','RESOLVED')).toBe(true);
  expect(canTransitionIncident('RESOLVED','CLOSED')).toBe(true);
  expect(canTransitionIncident('DETECTED','CLOSED')).toBe(false);
  expect(canTransitionIncident('CLOSED','DETECTED')).toBe(false);
 });
});
