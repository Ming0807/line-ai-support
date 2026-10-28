import {z} from 'zod';
const uuid=z.uuid().refine(value=>value===value.toLowerCase());
const revision=z.number().int().min(0).max(999_999_999);
/** Assigned catalog identifiers must be distinguishable from ordinary words in answer prose. */
export const reviewerAssignedServiceCodeSchema=z.string().min(6).max(80).regex(/^[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)+$/u);
const officialUrl=z.url().max(2000).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&(url.hostname==='yru.ac.th'||url.hostname.endsWith('.yru.ac.th'))&&url.href===value;}catch{return false;}});
const label=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim().length>0&&value.isWellFormed()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value));
export const transcriptionHtmlLocationSchema=z.object({kind:z.literal('HTML'),sourceUrl:officialUrl,blockStart:z.number().int().min(1).max(100000),blockEnd:z.number().int().min(1).max(100000),headingPath:z.array(label(200)).max(16),tableIndex:z.null()}).strict().refine(value=>value.blockEnd>=value.blockStart);
export type TranscriptionHtmlLocation=z.infer<typeof transcriptionHtmlLocationSchema>;
export const serviceTranscriptionParentSchema=z.object({documentId:uuid,familyId:uuid,documentRevision:revision,jobId:uuid,jobRevision:revision.min(1),extractionRevision:revision.min(1),reviewRevision:revision.min(1),sourceChecksum:z.string().regex(/^[a-f0-9]{64}$/u),sourceUrl:officialUrl,title:label(500)}).strict().refine(value=>value.extractionRevision<=value.jobRevision);
const field=z.discriminatedUnion('kind',[
 z.object({field:z.enum(['name','description','location','opening_hours','phone','email','url']),kind:z.literal('TEXT'),parts:z.array(z.object({location:transcriptionHtmlLocationSchema,start:z.number().int().min(0).max(5_000_000),end:z.number().int().min(1).max(5_000_000)}).strict().refine(value=>value.end>value.start)).min(1).max(3)}).strict(),
 z.object({field:z.literal('url'),kind:z.literal('PARENT_URL')}).strict(),
]);
export const serviceTranscriptionSchema=z.object({kind:z.literal('REVIEWED_HTML_TO_CSV_V1'),dataset:z.literal('university_services'),reason:label(500),parent:serviceTranscriptionParentSchema,fields:z.array(field).min(1).max(7)}).strict().refine(value=>new Set(value.fields.map(f=>f.field)).size===value.fields.length);
export type ServiceTranscription=z.infer<typeof serviceTranscriptionSchema>;
export const serviceTranscriptionProofSchema=z.object({kind:z.literal('PUBLIC_SERVICE_TRANSCRIPTION_PROOF_V1'),manifestDigest:z.string().regex(/^[a-f0-9]{64}$/u),parent:serviceTranscriptionParentSchema,sourceLocations:z.array(transcriptionHtmlLocationSchema).min(1).max(8)}).strict();
export type ServiceTranscriptionProof=z.infer<typeof serviceTranscriptionProofSchema>;
