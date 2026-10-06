import {PublicationPolicyError} from './publication-contract';
import {ImportChunkPlanError} from './chunk-preparation';
import {importApiFailure,importPrivateJson} from './import-api';
export function publicationApiFailure(error:unknown):Response{
 if(error instanceof PublicationPolicyError){
  const status=error.code==='PUBLICATION_PLAN_MISMATCH'||error.code==='PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE'?409:422;
  return importPrivateJson({error:error.code},status);
 }
 if(error instanceof ImportChunkPlanError)return importPrivateJson({error:error.code},error.status);
 return importApiFailure(error);
}
