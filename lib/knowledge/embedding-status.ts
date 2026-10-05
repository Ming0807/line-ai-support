import {withProviderAdminTransaction} from '../ai/provider-admin';
import {createLocalE5EmbeddingProvider} from './embedding-client';

/** Snapshot/final active SUPER_ADMIN checks, with infrastructure HTTP outside SQL. */
export async function getEmbeddingStatus(staffId:string){
 await withProviderAdminTransaction(staffId,{},async()=>undefined);
 const health=await createLocalE5EmbeddingProvider().healthCheck();
 await withProviderAdminTransaction(staffId,{},async()=>undefined);
 return {healthy:health.healthy,model:health.model,dimension:health.dimension,mode:health.mode,
  observedAt:health.observedAt,httpStatus:health.httpStatus};
}
