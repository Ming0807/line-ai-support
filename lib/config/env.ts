import { z } from 'zod';

export { readPublicEnv } from './public-env';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());
const optionalHttpUrl = z.preprocess(
  blankToUndefined,
  z.string().trim().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }).optional(),
);
const httpUrlOrEmpty = optionalHttpUrl.transform((value) => value ?? '');
const optionalConnectionUrl = z.preprocess(blankToUndefined, z.string().trim().url().optional());
const textOrEmpty = optionalText.transform((value) => value ?? '');
const httpUrl = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
});

const timeout = (fallback: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().min(1_000).max(max),
  );

const serverSchema = z.object({
  supabaseUrl: httpUrlOrEmpty,
  supabasePublishableKey: textOrEmpty,
  supabaseSecretKey: optionalText,
  databaseUrl: optionalConnectionUrl,
  directUrl: optionalConnectionUrl,
  encryptionKey: z.preprocess(
    blankToUndefined,
    z.string().trim().optional().refine((value) => {
      if (value === undefined) return true;
      const decoded = Buffer.from(value, 'base64');
      return decoded.byteLength === 32 && decoded.toString('base64') === value;
    }, 'ENCRYPTION_KEY must be a base64-encoded 32-byte key'),
  ),
  appBaseUrl: httpUrl,
  defaultAiTimeoutMs: timeout(20_000, 120_000),
  hardAiTimeoutMs: timeout(45_000, 300_000),
  lineStudentChannelSecret: optionalText,
  lineStudentChannelAccessToken: optionalText,
  lineStaffChannelSecret: optionalText,
  lineStaffChannelAccessToken: optionalText,
}).superRefine((env, context) => {
  if (env.defaultAiTimeoutMs > env.hardAiTimeoutMs) {
    context.addIssue({
      code: 'custom',
      path: ['defaultAiTimeoutMs'],
      message: 'DEFAULT_AI_TIMEOUT_MS must not exceed HARD_AI_TIMEOUT_MS',
    });
  }
});

export type ServerEnv = z.infer<typeof serverSchema> & {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey?: string;
  databaseUrl?: string;
  directUrl?: string;
  encryptionKey?: string;
  lineStudentChannelSecret?: string;
  lineStudentChannelAccessToken?: string;
  lineStaffChannelSecret?: string;
  lineStaffChannelAccessToken?: string;
};

function firstValue(source: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function normalize(source: NodeJS.ProcessEnv) {
  return {
    supabaseUrl: firstValue(source, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL') ?? '',
    supabasePublishableKey: firstValue(
      source,
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_ANON_KEY',
    ) ?? '',
    supabaseSecretKey: source.SUPABASE_SECRET_KEY ?? source.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: source.DATABASE_URL,
    directUrl: source.DIRECT_URL ?? source.SUPABASE_DIRECT_DATABASE_URL,
    encryptionKey: source.ENCRYPTION_KEY,
    appBaseUrl: firstValue(source, 'APP_BASE_URL') ?? 'http://localhost:3000',
    defaultAiTimeoutMs: source.DEFAULT_AI_TIMEOUT_MS,
    hardAiTimeoutMs: source.HARD_AI_TIMEOUT_MS,
    lineStudentChannelSecret: source.LINE_STUDENT_CHANNEL_SECRET,
    lineStudentChannelAccessToken: source.LINE_STUDENT_CHANNEL_ACCESS_TOKEN,
    lineStaffChannelSecret: source.LINE_STAFF_CHANNEL_SECRET,
    lineStaffChannelAccessToken: source.LINE_STAFF_CHANNEL_ACCESS_TOKEN,
  };
}

/** Parse server-only configuration. Empty optional integrations are treated as unconfigured. */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverSchema.parse(normalize(source)) as ServerEnv;
}

