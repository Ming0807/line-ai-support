import {z} from 'zod';
import {knowledgeScopeSchema} from './retrieval';
import {structuredAnswerSchema,structuredEvidenceListSchema} from './structured-citations';
import {copyStructuredJson} from '../imports/structured-mapping-contract';

/** A separate bounded catalog operation; exact Query1 minimum selectors stay unchanged. */
export const structuredDiscoveryDatasets=['academic_calendar_events','university_services','service_forms'] as const;
export const structuredDiscoveryRequestSchema=z.strictObject({dataset:z.enum(structuredDiscoveryDatasets),scope:knowledgeScopeSchema});
export type StructuredDiscoveryRequest=z.infer<typeof structuredDiscoveryRequestSchema>;
export const structuredDiscoveryResultSchema=z.strictObject({kind:z.literal('STRUCTURED_DISCOVERY'),dataset:z.enum(structuredDiscoveryDatasets),
 scope:knowledgeScopeSchema,output:structuredAnswerSchema,evidence:structuredEvidenceListSchema,support:z.never().optional()})
 .superRefine((value,context)=>{
  try{
   copyStructuredJson(value,128*1024,20_000);
   if(value.evidence.some(row=>row.dataset!==value.dataset))throw Error('DISCOVERY_DATASET_MISMATCH');
  }catch{context.addIssue({code:'custom',message:'STRUCTURED_DISCOVERY_INVALID'});}
 });
