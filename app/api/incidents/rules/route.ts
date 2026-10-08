import {incidentRead,incidentMutation} from '@/lib/incidents/api';
export const runtime='nodejs';
export async function GET(request:Request){return incidentRead(request,'rules');}
export async function PUT(request:Request){return incidentMutation(request,'rules');}
