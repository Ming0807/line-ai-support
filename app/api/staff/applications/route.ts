import {getApplications,postApplication} from '@/lib/staff/applications-api';
export const runtime='nodejs';
export async function GET(request:Request){return getApplications(request);}
export async function POST(request:Request){return postApplication(request);}
