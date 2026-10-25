import {incidentBatchLatestDraft} from '@/lib/incidents/batch-api';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;return incidentBatchLatestDraft(request,id);
}
