export const INCIDENT_NOW='2026-10-08T00:15:00.000Z';
const departmentId='11111111-1111-4111-8111-111111111111';

export function unitVector(angleDegrees=0):number[]{
 const radians=angleDegrees*Math.PI/180,vector=Array.from({length:384},()=>0);
 vector[0]=Math.cos(radians);vector[1]=Math.sin(radians);return vector;
}

export function ticketDescriptor(index:number,overrides:Record<string,unknown>={}){
 return {
  id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
  revision:1,
  departmentId,
  category:'IT_NETWORK',
  systemCode:'CAMPUS_NETWORK',
  locationCode:'SCIENCE_BUILDING',
  sensitivity:'GENERAL',
  createdAt:'2026-10-08T00:05:00.000Z',
  status:'WAITING_STAFF',
  anonymousSessionKey:`private-session-key-${index}`,
  vector:unitVector(),
  ...overrides,
 };
}

export function incidentConfig(overrides:Record<string,unknown>={}){
 return {minReports:2,minDistinctSessions:2,windowMinutes:15,minSimilarity:0.85,...overrides};
}
