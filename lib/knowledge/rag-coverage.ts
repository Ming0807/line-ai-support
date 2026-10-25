import {z} from 'zod';
import {ragCompletionSchema,ragAnswerSchema} from './citations';

/** Coverage is a proposal, never permission to bypass reviewed source/citation validation. */
export const ragCoverageCompletionSchema=z.strictObject({coverage:z.enum(['FULL','PARTIAL','NONE']),
 answer:ragAnswerSchema.shape.answer.nullable(),citationChunkIds:z.array(z.uuid()).max(5),
 limitation:ragAnswerSchema.shape.answer.max(2000).nullable(),
}).refine(value=>value.coverage==='NONE'?value.answer===null&&value.citationChunkIds.length===0:
 ragAnswerSchema.safeParse({answer:value.answer,citationChunkIds:value.citationChunkIds}).success)
 .refine(value=>value.coverage==='PARTIAL'?value.limitation!==null:value.limitation===null);
export function normalizeRagCoverageCompletion(input:unknown):z.infer<typeof ragCompletionSchema>{
 const parsed=ragCoverageCompletionSchema.safeParse(input);if(!parsed.success)throw Error('RAG_COVERAGE_INVALID');
 const value=parsed.data;
 const answer=value.coverage==='NONE'?null:value.coverage==='FULL'?value.answer:
  `จากข้อมูลที่ค้นพบ ตอบได้บางส่วนดังนี้ครับ:\n\n${value.answer}\n\nข้อจำกัดของข้อมูล: ${value.limitation}`;
 const normalized=ragCompletionSchema.safeParse({answer,citationChunkIds:value.citationChunkIds});
 if(!normalized.success)throw Error('RAG_COVERAGE_INVALID');
 return normalized.data;
}
