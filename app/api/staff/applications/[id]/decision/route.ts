import {decideApplication} from '@/lib/staff/applications-api';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 return decideApplication(request,(await context.params).id);
}
