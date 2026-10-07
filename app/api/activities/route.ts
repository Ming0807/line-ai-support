import {operationsHandler} from '@/lib/operations/api';
export const runtime='nodejs';
export async function GET(request:Request){return operationsHandler(request,'activities');}
