import {getOnboarding} from '@/lib/staff/applications-api';
export const runtime='nodejs';
export async function GET(request:Request){return getOnboarding(request);}
