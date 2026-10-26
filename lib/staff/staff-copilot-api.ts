import {staffAdviceHandler} from './ai-assistance-api';
import {createStaffCopilotAssistance} from './staff-copilot';
export const staffCopilotHandler=(request:Request,id:string)=>staffAdviceHandler(request,id,createStaffCopilotAssistance,'STAFF_COPILOT_FAILED');
