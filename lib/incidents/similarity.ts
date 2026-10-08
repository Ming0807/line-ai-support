import {incidentVectorSchema,IncidentError} from './contracts';
/** E5 vectors are normalized once by existing local infrastructure; malformed vectors never rank. */
export function cosineSimilarity(a:number[],b:number[]):number{
 if(!incidentVectorSchema.safeParse(a).success||!incidentVectorSchema.safeParse(b).success)throw new IncidentError('INCIDENT_INPUT_INVALID');
 let dot=0;for(let i=0;i<384;i++)dot+=a[i]*b[i];
 return Math.max(-1,Math.min(1,dot/(Math.hypot(...a)*Math.hypot(...b))));
}
