import { describe, expect, it } from 'vitest';
import { readPublicEnv, readServerEnv } from '@/lib/config/env';

function processEnv(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

describe('environment configuration', () => {
  it('allows app startup with no Supabase or optional integration settings', () => {
    const env = readServerEnv(processEnv({}));

    expect(env.supabaseUrl).toBe('');
    expect(env.supabasePublishableKey).toBe('');
    expect(env.lineStudentChannelSecret).toBeUndefined();
  });

  it('allows blank optional integrations without blocking app configuration', () => {
    const env = readServerEnv(processEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      LINE_STUDENT_CHANNEL_SECRET: '   ',
      LINE_STUDENT_CHANNEL_ACCESS_TOKEN: '',
      AI_API_KEY: '',
    }));

    expect(env.lineStudentChannelSecret).toBeUndefined();
    expect(env.lineStudentChannelAccessToken).toBeUndefined();
  });

  it('prefers modern publishable keys over legacy anon keys', () => {
    const env = readServerEnv(processEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://public.supabase.co',
      SUPABASE_URL: 'https://server.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_modern',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_server',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy_public',
      SUPABASE_ANON_KEY: 'legacy_server',
    }));

    expect(env.supabaseUrl).toBe('https://public.supabase.co');
    expect(env.supabasePublishableKey).toBe('sb_publishable_modern');
  });

  it('rejects malformed encryption keys and unsafe timeout combinations', () => {
    expect(() => readServerEnv(processEnv({ ENCRYPTION_KEY: 'not-base64' }))).toThrow();
    expect(() => readServerEnv(processEnv({
      DEFAULT_AI_TIMEOUT_MS: '50000',
      HARD_AI_TIMEOUT_MS: '45000',
    }))).toThrow();
    expect(() => readServerEnv(processEnv({ DEFAULT_AI_TIMEOUT_MS: '0' }))).toThrow();
  });

  it('returns only public Supabase connection values from the public reader', () => {
    const env = readPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      SUPABASE_SECRET_KEY: 'must-not-leak',
      ENCRYPTION_KEY: 'must-not-leak',
      LINE_STUDENT_CHANNEL_SECRET: 'must-not-leak',
    });

    expect(env).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'sb_publishable_example',
    });
    expect(JSON.stringify(env)).not.toContain('must-not-leak');
  });
});
