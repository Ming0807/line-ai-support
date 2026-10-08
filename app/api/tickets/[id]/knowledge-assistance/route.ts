import {staffKnowledgeHandler} from '@/lib/staff/knowledge-assistance-api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return staffKnowledgeHandler(request,id);}
