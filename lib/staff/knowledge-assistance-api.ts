import {staffAdviceHandler} from './ai-assistance-api';
import {createStaffKnowledgeAssistance} from './knowledge-assistance';
export const staffKnowledgeHandler=(request:Request,id:string)=>staffAdviceHandler(request,id,createStaffKnowledgeAssistance,'STAFF_KNOWLEDGE_FAILED');
