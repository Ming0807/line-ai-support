import {z} from 'zod';

export const routerOutputSchema=z.object({
 intent:z.string().min(1).max(100),category:z.string().min(1).max(100),subcategory:z.string().max(100).nullable(),
 needsTicket:z.boolean(),department:z.string().max(50).nullable(),urgency:z.enum(['low','medium','high','critical']),
 needsKnowledgeSearch:z.boolean(),needsStructuredSearch:z.boolean(),needsWebSearch:z.boolean(),confidence:z.number().min(0).max(1),
}).strict();

export const answerOutputSchema=z.object({answer:z.string().min(1).max(4000),confidence:z.number().min(0).max(1),
 needsClarification:z.boolean(),needsTicket:z.boolean(),department:z.string().max(50).nullable(),
 citations:z.array(z.object({documentId:z.uuid(),chunkId:z.uuid()}).strict()).max(8),
}).strict();
