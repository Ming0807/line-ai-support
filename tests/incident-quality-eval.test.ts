import {describe,expect,it} from 'vitest';
import {detectIncidentCandidate} from '../lib/incidents/detector';

// These vectors are hand-built geometric probes, not outputs from the E5 model.
// “Same issue” and “different issue” below describe the test author's intended
// geometry only; they do not establish semantic embedding quality.
const NOW='2026-10-30T00:15:00.000Z';
const CONFIG={minReports:2,minDistinctSessions:2,windowMinutes:15,minSimilarity:.85};
const DEPARTMENT='11111111-1111-4111-8111-111111111111';

function unitVector(angleDegrees:number):number[]{
 const radians=angleDegrees*Math.PI/180;
 return Array.from({length:384},(_,index)=>index===0?Math.cos(radians):index===1?Math.sin(radians):0);
}

function report(index:number,overrides:Record<string,unknown>={}){
 return {
  id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
  revision:1,
  departmentId:DEPARTMENT,
  category:'IT_NETWORK',
  systemCode:'CAMPUS_NETWORK',
  locationCode:'SCIENCE_BUILDING',
  sensitivity:'GENERAL',
  status:'WAITING_STAFF',
  createdAt:'2026-10-30T00:05:00.000Z',
  anonymousSessionKey:`synthetic-session-${index}`,
  vector:unitVector(0),
  ...overrides,
 };
}

function memberIds(result:ReturnType<typeof detectIncidentCandidate>):string[]{
 return result?.members.map(member=>member.ticketId).sort()??[];
}

describe('synthetic incident quality probes (not model evaluation)',()=>{
 it('accepts a same-category, same-system/location geometric near-neighbour cohort',()=>{
  const anchor=report(1),near=report(2,{vector:unitVector(15)});
  const result=detectIncidentCandidate(anchor,[anchor,near],NOW,CONFIG);

  expect(result?.reportCount).toBe(2);
  expect(result?.distinctSessionCount).toBe(2);
  expect(memberIds(result)).toEqual([anchor.id,near.id]);
 });

 it('rejects a same-category/context cohort whose synthetic vectors are below threshold',()=>{
  const anchor=report(1),orthogonal=report(2,{vector:unitVector(90)});

  expect(detectIncidentCandidate(anchor,[anchor,orthogonal],NOW,CONFIG)).toBeNull();
 });

 it.each([
  ['different system',{systemCode:'STUDENT_RECORDS'}],
  ['different location',{locationCode:'ADMIN_BUILDING'}],
 ] as const)('rejects otherwise near neighbours with a known %s conflict',(_label,conflict)=>{
  const anchor=report(1),other=report(2,{...conflict,vector:unitVector(5)});

  expect(detectIncidentCandidate(anchor,[anchor,other],NOW,CONFIG)).toBeNull();
 });

 it('keeps category as a hard guard even when synthetic vectors are near',()=>{
  const anchor=report(1),other=report(2,{category:'STUDENT_RECORDS',vector:unitVector(5)});

  expect(detectIncidentCandidate(anchor,[anchor,other],NOW,CONFIG)).toBeNull();
 });

 it('propagates the highest declared sensitivity; this does not establish personal-record grouping policy',()=>{
  const anchor=report(1),restricted=report(2,{sensitivity:'RESTRICTED',vector:unitVector(5)});
  const result=detectIncidentCandidate(anchor,[anchor,restricted],NOW,CONFIG);

  expect(result?.reportCount).toBe(2);
  expect(result?.maxSensitivity).toBe('RESTRICTED');
 });

 it('is invariant to input-array permutations when the anchor remains fixed',()=>{
  const anchor=report(1),nearA=report(2,{vector:unitVector(10)}),nearB=report(3,{vector:unitVector(-10)});
  const permutations=[
   [anchor,nearA,nearB],
   [nearB,anchor,nearA],
   [nearA,nearB,anchor],
  ];

  const results=permutations.map(input=>detectIncidentCandidate(anchor,input,NOW,{...CONFIG,minReports:3,minDistinctSessions:3}));
  expect(results.map(memberIds)).toEqual(Array(3).fill([anchor.id,nearA.id,nearB.id].sort()));
 });

 it('characterizes current anchor sensitivity for a non-transitive synthetic similarity set',()=>{
  // A is within .85 of B and C, but B and C are not within .85 of each other.
  // The detector's pairwise rule admits one cohort member after the anchor;
  // changing the anchor changes which member is excluded. This is a known
  // algorithmic quality limitation, not a claim that the vectors reflect text.
  const a=report(1),b=report(2,{vector:unitVector(25)}),c=report(3,{vector:unitVector(-25)});
  const candidates=[a,b,c];
  const fromA=memberIds(detectIncidentCandidate(a,candidates,NOW,CONFIG));
  const fromB=memberIds(detectIncidentCandidate(b,candidates,NOW,CONFIG));
  const fromC=memberIds(detectIncidentCandidate(c,candidates,NOW,CONFIG));

  expect(fromA).toEqual([a.id,b.id]);
  expect(fromB).toEqual([a.id,b.id]);
  expect(fromC).toEqual([a.id,c.id]);
  expect(new Set([fromA.join(','),fromB.join(','),fromC.join(',')]).size).toBeGreaterThan(1);
 });
});
