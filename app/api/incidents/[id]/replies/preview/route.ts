import {incidentBatchPreview} from '@/lib/incidents/batch-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return incidentBatchPreview(request,(await params).id);}
