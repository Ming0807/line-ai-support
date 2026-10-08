import {impactSchema,type VerifiedImpact,type IncidentStatus} from './contracts';
export function deriveIncidentSeverity(distinctReporters:number,verifiedImpact?:VerifiedImpact):'MEDIUM'|'HIGH'|'CRITICAL'{
 const impact=verifiedImpact?impactSchema.parse(verifiedImpact):null;
 if(impact?.campusWide&&impact.criticalService&&impact.confirmedOutage)return 'CRITICAL';
 return distinctReporters>1?'HIGH':'MEDIUM';
}
const transitions:Record<IncidentStatus,readonly IncidentStatus[]>={
 DETECTED:['INVESTIGATING'],INVESTIGATING:['MONITORING','RESOLVED'],MONITORING:['INVESTIGATING','RESOLVED'],RESOLVED:['INVESTIGATING','CLOSED'],CLOSED:[],
};
export function canTransitionIncident(from:IncidentStatus,to:IncidentStatus):boolean{return transitions[from].includes(to);}
