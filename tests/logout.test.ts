import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string }>,
  deleted: [] as string[],
  deleteCookie: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  readServerEnv: vi.fn(() => ({ supabaseUrl: 'https://project-ref.supabase.co' })),
  readPublicEnv: vi.fn(() => ({ supabaseUrl: '', supabasePublishableKey: '' })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => mocks.cookies,
    delete: mocks.deleteCookie,
  })),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/config/env', () => ({ readServerEnv: mocks.readServerEnv }));
vi.mock('@/lib/config/public-env', () => ({ readPublicEnv: mocks.readPublicEnv }));
vi.mock('@/lib/supabase/server', () => ({
  createUserClient: vi.fn(async () => ({ auth: { signOut: mocks.signOut } })),
}));

import { signOutAction } from '@/app/auth/actions';

describe('server logout', () => {
  beforeEach(() => {
    mocks.cookies = [
      { name: 'sb-project-ref-auth-token', value: 'access-refresh-token' },
      { name: 'sb-project-ref-auth-token.0', value: 'chunk-zero' },
      { name: 'sb-project-ref-auth-token.1', value: 'chunk-one' },
      { name: 'sb-project-ref-auth-token.extra', value: 'not-a-numbered-chunk' },
      { name: 'sb-other-project-auth-token', value: 'other-project-token' },
      { name: 'theme', value: 'dark' },
    ];
    mocks.deleted = [];
    mocks.deleteCookie.mockReset().mockImplementation((name: string) => mocks.deleted.push(name));
    mocks.signOut.mockReset();
    mocks.redirect.mockClear();
    mocks.readServerEnv.mockClear();
    mocks.readPublicEnv.mockClear();
  });

  it('clears the current project token after provider failure with server-only SUPABASE_URL', async () => {
    mocks.signOut.mockRejectedValue(new Error('provider unavailable'));

    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login');
    expect(mocks.deleted).toEqual([
      'sb-project-ref-auth-token',
      'sb-project-ref-auth-token.0',
      'sb-project-ref-auth-token.1',
    ]);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.readServerEnv).toHaveBeenCalledOnce();
    expect(mocks.readPublicEnv).not.toHaveBeenCalled();
  });

  it('clears only this project token and numeric chunks after a successful local sign-out', async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await expect(signOutAction()).rejects.toThrow(/^REDIRECT:\/login$/);
    expect(mocks.deleted).toEqual([
      'sb-project-ref-auth-token',
      'sb-project-ref-auth-token.0',
      'sb-project-ref-auth-token.1',
    ]);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('cleans cookies and redirects normally when Supabase returns a sign-out error', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('provider unavailable') });

    await expect(signOutAction()).rejects.toThrow(/^REDIRECT:\/login$/);
    expect(mocks.deleted).toEqual([
      'sb-project-ref-auth-token',
      'sb-project-ref-auth-token.0',
      'sb-project-ref-auth-token.1',
    ]);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('uses signout_failed only when cookie cleanup cannot complete', async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.deleteCookie.mockImplementation(() => {
      throw new Error('cookie response unavailable');
    });

    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login?error=signout_failed');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/login?error=signout_failed');
  });
});
