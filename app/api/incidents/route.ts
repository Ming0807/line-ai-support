import {incidentRead} from '@/lib/incidents/api';
export const runtime='nodejs';
export async function GET(request:Request){return incidentRead(request,'list');}
