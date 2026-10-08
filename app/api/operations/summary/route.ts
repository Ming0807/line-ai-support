import {metricsHandler} from '@/lib/operations/metrics-api';
export const runtime='nodejs';
export async function GET(request:Request){return metricsHandler(request,'summary');}
