import {incidentBatchStatus} from '@/lib/incidents/batch-api';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return incidentBatchStatus(request,(await params).id);}
