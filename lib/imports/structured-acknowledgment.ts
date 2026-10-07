import {canonicalDigest,freezeStructuredData,type StructuredMappingPlan} from './structured-mapping-contract';

/** Content acknowledgment is stable across review saves; the full plan still binds its exact counter. */
export function computeStructuredAcknowledgment(plan:StructuredMappingPlan){
 const {digest:_digest,binding,...content}=plan;
 const {reviewRevision:_reviewRevision,...sourceBinding}=binding;
 void _digest;void _reviewRevision;
 return freezeStructuredData({contentDigest:canonicalDigest('structured-ack-v1',{...content,binding:sourceBinding}),mapperVersion:plan.mapperVersion});
}
