import {incidentRead} from '@/lib/incidents/api';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return incidentRead(request,'detail',(await params).id);}
