import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authGetClaims, profileMaybeSingle, redirectMock } = vi.hoisted(() => ({
  authGetClaims: vi.fn(),
  profileMaybeSingle: vi.fn(),
  redirectMock: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/supabase/server', () => ({
  createUserClient: vi.fn(async () => ({
    auth: { getClaims: authGetClaims },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: profileMaybeSingle })),
      })),
    })),
  })),
}));

import { requireStaff } from '@/lib/auth/staff';
import { safeRedirectTarget } from '@/lib/auth/redirect';

describe('staff access policy', () => {
  beforeEach(() => {
    authGetClaims.mockReset();
    profileMaybeSingle.mockReset();
    redirectMock.mockClear();
  });

  it('accepts only internal redirect targets', () => {
    expect(safeRedirectTarget('/tickets?status=open')).toBe('/tickets?status=open');
    expect(safeRedirectTarget('https://outside.example')).toBe('/dashboard');
    expect(safeRedirectTarget('//outside.example')).toBe('/dashboard');
    expect(safeRedirectTarget('/\\outside.example')).toBe('/dashboard');
  });

  it('requires a verified user and denies inactive or unknown staff without database details', async () => {
    authGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    await expect(requireStaff()).rejects.toThrow('REDIRECT:/login');

    authGetClaims.mockResolvedValue({ data: { claims: { sub: 'auth-1' } }, error: null });
    profileMaybeSingle.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    await expect(requireStaff()).rejects.toThrow('REDIRECT:/login?error=access_denied');
    expect(redirectMock.mock.calls.at(-1)?.[0]).not.toContain('private database detail');

    profileMaybeSingle.mockResolvedValue({ data: { id: 'p1', active: false }, error: null });
    await expect(requireStaff()).rejects.toThrow('REDIRECT:/login?error=access_denied');
  });
});
