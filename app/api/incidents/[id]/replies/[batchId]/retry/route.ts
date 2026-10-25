import {incidentBatchRetry} from '@/lib/incidents/batch-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string;batchId:string}>}){const ids=await params;return incidentBatchRetry(request,ids.id,ids.batchId);}
