import { z } from 'zod';
import { ticketFiltersSchema, type TicketFilters } from '../../types/tickets';

export const inboxViewSchema = z.enum([
  'all', 'mine', 'unassigned', 'unread', 'waiting_staff', 'waiting_user',
]);
const inboxCategorySchema = z.string().regex(/^[A-Z][A-Z0-9_:-]{0,99}$/u);
const threadLimitSchema = z.string()
  .regex(/^[1-9][0-9]*$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100));
const beforeSequenceSchema = z.string()
  .regex(/^[1-9][0-9]*$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER));

type InboxView = z.infer<typeof inboxViewSchema>;
export type InboxQuery = TicketFilters & { view: InboxView; category?: string };
export type ThreadQuery = { beforeSequence?: number; limit: number };

function queryValues(params: URLSearchParams): Record<string, unknown> {
  return Object.fromEntries([...new Set(params.keys())].map(key => {
    const values = params.getAll(key);
    return [key, values.length === 1 ? values[0] : values];
  }));
}

export function parseInboxQuery(params: URLSearchParams): InboxQuery {
  const { view: rawView, category: rawCategory, ...ticketValues } = queryValues(params);
  const filters = ticketFiltersSchema.parse(ticketValues);
  const view = inboxViewSchema.parse(rawView ?? 'all');
  const category = rawCategory === undefined ? undefined : inboxCategorySchema.parse(rawCategory);
  return {
    ...filters,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 25,
    view,
    ...(category === undefined ? {} : { category }),
  };
}

const threadQuerySchema = z.strictObject({
  beforeSequence: beforeSequenceSchema.optional(),
  limit: threadLimitSchema.optional(),
});

export function parseThreadQuery(params: URLSearchParams): ThreadQuery {
  const parsed = threadQuerySchema.parse(queryValues(params));
  return { ...(parsed.beforeSequence === undefined ? {} : { beforeSequence: parsed.beforeSequence }), limit: parsed.limit ?? 50 };
}

export const readChatInputSchema = z.strictObject({
  throughSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const noteChatInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000)
    .refine(value => !/[\p{Cc}]/u.test(value.replace(/[\r\n\t]/gu, ''))),
  requestId: z.uuid(),
});
