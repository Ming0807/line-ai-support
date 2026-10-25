import {incidentBatchConfirm} from '@/lib/incidents/batch-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return incidentBatchConfirm(request,(await params).id);}
