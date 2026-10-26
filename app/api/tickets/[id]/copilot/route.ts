import {staffCopilotHandler} from '@/lib/staff/staff-copilot-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;return staffCopilotHandler(request,id);
}
