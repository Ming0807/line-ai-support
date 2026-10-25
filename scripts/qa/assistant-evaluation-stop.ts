import {z} from 'zod';

const reportSchema=z.object({
 sourceUnchanged:z.literal(true),caseIds:z.array(z.string()),
 records:z.array(z.object({caseId:z.string(),componentStatus:z.string(),
  turns:z.array(z.object({question:z.string(),completed:z.boolean()})),
 })),
});

/** Dispatch eligibility only. A null result NEVER establishes semantic acceptance. */
export function evaluationStopReason(
 expected:{caseId:string;questions:readonly string[]},
 input:{exit:number|null;exactCleanup:boolean;report:unknown},
):string|null{
 if(input.exit!==0)return 'PROCESS_FAILED';
 if(!input.exactCleanup)return 'CLEANUP_NOT_PROVEN';
 const parsed=reportSchema.safeParse(input.report);
 if(!parsed.success)return 'REPORT_OR_SOURCE_INVALID';
 const {caseIds,records}=parsed.data;
 if(caseIds.length!==1||caseIds[0]!==expected.caseId||records.length!==1||records[0].caseId!==expected.caseId)return 'CASE_COVERAGE_INVALID';
 const record=records[0];
 if(record.componentStatus!=='WORKFLOW_OBSERVED')return 'WORKFLOW_BLOCKED';
 if(expected.questions.length===0||record.turns.length!==expected.questions.length||
  record.turns.some((turn,index)=>!turn.completed||turn.question!==expected.questions[index]))return 'TURNS_INCOMPLETE_OR_SUBSTITUTED';
 // Witnessed cancellation during HUMAN takeover is deliberately not classified by error code.
 // The existing case oracle and explicit transcript review still decide acceptance.
 return null;
}
