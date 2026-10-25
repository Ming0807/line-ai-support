import {describe,expect,it} from 'vitest';
import {evaluationStopReason} from '../scripts/qa/assistant-evaluation-stop';

const expected={caseId:'A09',questions:['hello','still broken']};
const good=()=>({exit:0,exactCleanup:true,report:{sourceUnchanged:true,caseIds:['A09'],records:[{caseId:'A09',componentStatus:'WORKFLOW_OBSERVED',turns:expected.questions.map(question=>({question,completed:true}))}]}});
describe('owned evaluation dispatch stop guard',()=>{
 it('permits only further review, not a semantic pass',()=>expect(evaluationStopReason(expected,good())).toBeNull());
 it.each([null,{}, {sourceUnchanged:true,caseIds:['A09'],records:[]}])('stops missing/malformed/empty reports',report=>expect(evaluationStopReason(expected,{...good(),report})).not.toBeNull());
 it('stops a failed child even when it wrote a report',()=>expect(evaluationStopReason(expected,{...good(),exit:1})).toBe('PROCESS_FAILED'));
 it('stops missing exact cleanup',()=>expect(evaluationStopReason(expected,{...good(),exactCleanup:false})).toBe('CLEANUP_NOT_PROVEN'));
 it('stops changed source',()=>{const input=good();input.report.sourceUnchanged=false;expect(evaluationStopReason(expected,input)).toBe('REPORT_OR_SOURCE_INVALID');});
 it('stops the first blocked workflow, including a completed fallback',()=>{const input=good();input.report.records[0].componentStatus='BLOCKED_OR_WORKFLOW_FAILED';expect(evaluationStopReason(expected,input)).toBe('WORKFLOW_BLOCKED');});
 it('rejects a substituted case',()=>{const input=good();input.report.records[0].caseId='A10';expect(evaluationStopReason(expected,input)).toBe('CASE_COVERAGE_INVALID');});
 it('rejects duplicate records',()=>{const input=good();input.report.records.push(input.report.records[0]);expect(evaluationStopReason(expected,input)).toBe('CASE_COVERAGE_INVALID');});
 it('rejects missing turns',()=>{const input=good();input.report.records[0].turns.pop();expect(evaluationStopReason(expected,input)).toBe('TURNS_INCOMPLETE_OR_SUBSTITUTED');});
 it('rejects a substituted original question',()=>{const input=good();input.report.records[0].turns[0].question='easier';expect(evaluationStopReason(expected,input)).toBe('TURNS_INCOMPLETE_OR_SUBSTITUTED');});
 it('rejects incomplete delivery',()=>{const input=good();input.report.records[0].turns[0].completed=false;expect(evaluationStopReason(expected,input)).toBe('TURNS_INCOMPLETE_OR_SUBSTITUTED');});
 it('does not mistake a witnessed takeover cancellation for a deadline failure',()=>{const input=good();Object.assign(input.report.records[0].turns[0],{observations:[{error_code:'CANCELLED'}]});expect(evaluationStopReason(expected,input)).toBeNull();});
});
