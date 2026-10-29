import {staffLineRoute} from '@/lib/auth/line-staff-route';
export const runtime='nodejs';
export async function GET(request:Request){return staffLineRoute(request,'BEGIN');}
