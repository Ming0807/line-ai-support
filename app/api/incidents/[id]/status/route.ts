import {incidentMutation} from '@/lib/incidents/api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return incidentMutation(request,'status',(await params).id);}
