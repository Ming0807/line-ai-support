import {bindingRead,bindingMutation} from '@/lib/staff/line-binding-api';
export const runtime='nodejs';
export async function GET(request:Request){return bindingRead(request);}
export async function DELETE(request:Request){return bindingMutation(request,'unlink');}
