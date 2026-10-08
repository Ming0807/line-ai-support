import {staffAssistHandler} from '@/lib/staff/ai-assistance-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return staffAssistHandler(request,id);}
