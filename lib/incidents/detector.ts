import {DEFAULT_INCIDENT_CONFIG,IncidentError,incidentConfigSchema,ticketDescriptorSchema,type IncidentCandidate,type TicketDescriptor} from './contracts';
import {cosineSimilarity} from './similarity';
import {deriveIncidentSeverity} from './severity';
const inactive=new Set(['RESOLVED','CLOSED','CANCELLED']);
const sensitivityRank={GENERAL:0,SENSITIVE:1,RESTRICTED:2} as const;
function compatible(a:TicketDescriptor,b:TicketDescriptor):boolean{
 return a.departmentId===b.departmentId&&a.category===b.category
  &&!(a.systemCode&&b.systemCode&&a.systemCode!==b.systemCode)
  &&!(a.locationCode&&b.locationCode&&a.locationCode!==b.locationCode);
}
/** Existing membership is permanent history; the rolling detection window must not hide conflicting older members. */
export function canExtendIncident(existing:unknown[],proposed:unknown[],minSimilarity:number):boolean{
 if(existing.length===0||!Number.isFinite(minSimilarity)||minSimilarity<.5||minSimilarity>1)return false;
 const members=new Map<string,TicketDescriptor>();
 for(const raw of [...existing,...proposed]){
  const parsed=ticketDescriptorSchema.safeParse(raw);if(!parsed.success)return false;
  const previous=members.get(parsed.data.id);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(parsed.data))return false;
  members.set(parsed.data.id,parsed.data);
 }
 if(members.size>500)return false;
 const values=[...members.values()];
 return values.every((a,i)=>values.slice(i+1).every(b=>compatible(a,b)&&cosineSimilarity(a.vector,b.vector)>=minSimilarity));
}
export function detectIncidentCandidate(anchorInput:unknown,input:unknown[],nowISO:string,configInput:unknown=DEFAULT_INCIDENT_CONFIG):IncidentCandidate|null{
 const anchor=ticketDescriptorSchema.safeParse(anchorInput),config=incidentConfigSchema.safeParse(configInput),now=Date.parse(nowISO);
 if(!anchor.success||!config.success||!Number.isFinite(now)||!Array.isArray(input)||input.length>500)throw new IncidentError('INCIDENT_INPUT_INVALID');
 const unique=new Map<string,TicketDescriptor>();
 for(const raw of [anchor.data,...input]){
  const parsed=ticketDescriptorSchema.safeParse(raw);if(!parsed.success)throw new IncidentError('INCIDENT_INPUT_INVALID');
  const existing=unique.get(parsed.data.id);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(parsed.data))throw new IncidentError('INCIDENT_INPUT_INVALID');
  unique.set(parsed.data.id,parsed.data);
 }
 const eligible=(t:TicketDescriptor)=>!inactive.has(t.status)&&Date.parse(t.createdAt)<=now&&Date.parse(t.createdAt)>=now-config.data.windowMinutes*60_000;
 if(!eligible(anchor.data))return null;
 const members=[anchor.data];
 for(const ticket of [...unique.values()].filter(t=>t.id!==anchor.data.id&&eligible(t)).sort((a,b)=>a.id.localeCompare(b.id))){
  if(members.every(other=>compatible(other,ticket)&&cosineSimilarity(other.vector,ticket.vector)>=config.data.minSimilarity))members.push(ticket);
 }
 const distinct=new Set(members.map(t=>t.anonymousSessionKey)).size;
 if(members.length<config.data.minReports||distinct<config.data.minDistinctSessions)return null;
 const sensitivity=members.reduce((level,t)=>sensitivityRank[t.sensitivity]>sensitivityRank[level]?t.sensitivity:level,anchor.data.sensitivity);
 return {members:members.map(t=>({ticketId:t.id,revision:t.revision,cosineSimilarity:cosineSimilarity(anchor.data.vector,t.vector)})),
  reportCount:members.length,distinctSessionCount:distinct,maxSensitivity:sensitivity,severity:deriveIncidentSeverity(distinct)};
}
