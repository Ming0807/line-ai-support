import {bindingMutation} from '@/lib/staff/line-binding-api';
export const runtime='nodejs';
export async function POST(request:Request){return bindingMutation(request,'challenge');}
