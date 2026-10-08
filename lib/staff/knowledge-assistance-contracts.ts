import {z} from 'zod';
const revision=z.number().int().min(0).max(2147483647);
const sourceUrl=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!/\p{Cc}/u.test(value);}catch{return false;}}).nullable();
const source=z.strictObject({title:z.string().min(1).max(500),academicYear:z.number().int().nullable(),url:sourceUrl,location:z.string().max(3000).nullable()});
export const staffKnowledgeAdviceSchema=z.discriminatedUnion('status',[
 z.strictObject({revision,status:z.literal('VERIFIED'),answer:z.string().min(1).max(3000),draftText:z.string().min(1).max(5000).nullable(),sources:z.array(source).min(1).max(5)}),
 z.strictObject({revision,status:z.literal('NOT_VERIFIED'),answer:z.string().min(1).max(2000),draftText:z.null(),sources:z.array(source).max(0)}),
 z.strictObject({revision,status:z.literal('NO_USER_QUESTION'),answer:z.null(),draftText:z.null(),sources:z.array(source).max(0)}),
]);
export type StaffKnowledgeAdvice=z.infer<typeof staffKnowledgeAdviceSchema>;
