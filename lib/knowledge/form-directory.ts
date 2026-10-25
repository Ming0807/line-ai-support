import {formDirectoryResultSchema,buildStructuredFormDirectory} from './structured-citations';

export {formDirectoryResultSchema} from './structured-citations';

/** Deterministic renderer for an already retrieved, validated set of reviewed public forms. */
export function buildFormDirectory(input:unknown){
 try{
  const result=formDirectoryResultSchema.parse(input);
  return buildStructuredFormDirectory(result.evidence);
 }catch(error){
  if(error instanceof Error&&error.message==='LINE_TEXT_PACKET_TOO_LARGE')throw error;
  throw new Error('STRUCTURED_CITATION_INVALID');
 }
}
