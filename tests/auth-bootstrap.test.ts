import { describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ACCOUNT_SPECS,
  EXPECTED_PROJECT_REF,
  developmentConfig,
  generatePassword,
  profileMatches,
  readCredentials,
  validateCredentials,
  writeCredentials,
} from '../scripts/auth/common';

const poolerUrl = `postgresql://postgres.${EXPECTED_PROJECT_REF}:fixture-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const execFileAsync = promisify(execFile);

async function createTemporaryDirectory(prefix: string): Promise<{ root: string; directory: string }> {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(join(root, prefix));
  return { root, directory };
}

async function removeTemporaryDirectory(root: string, directory: string): Promise<void> {
  const resolvedRoot = await realpath(root);
  const resolvedDirectory = await realpath(directory);
  const pathFromRoot = relative(resolvedRoot, resolvedDirectory);
  if (!pathFromRoot || isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error('TEMP_CLEANUP_TARGET_OUTSIDE_ROOT');
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

describe('development staff bootstrap contracts', () => {
  it('requires an explicitly matched development target and credentials', () => {
    expect(() => developmentConfig({
      YRU_DEPLOYMENT_ENV: 'development',
      DEV_SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-fixture',
      SUPABASE_SECRET_KEY: 'secret-fixture',
      DIRECT_URL: poolerUrl,
    }, true)).not.toThrow();

    expect(() => developmentConfig({
      YRU_DEPLOYMENT_ENV: 'production',
      DEV_SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-fixture',
      SUPABASE_SECRET_KEY: 'secret-fixture',
      DIRECT_URL: poolerUrl,
    }, true)).toThrow('DEVELOPMENT_TARGET_MISMATCH');

    expect(() => developmentConfig({
      YRU_DEPLOYMENT_ENV: 'development',
      DEV_SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-fixture',
      DIRECT_URL: poolerUrl,
    }, true)).toThrow('DEVELOPMENT_ADMIN_KEY_MISSING');

    expect(() => developmentConfig({
      YRU_DEPLOYMENT_ENV: 'development',
      DEV_SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-fixture',
      SUPABASE_SECRET_KEY: 'secret-fixture',
      DIRECT_URL: `${poolerUrl}?host=attacker.invalid`,
    }, true)).toThrow('DEVELOPMENT_TARGET_MISMATCH');
  });

  it('generates a strong password accepted by the local credentials contract', () => {
    const password = generatePassword();
    expect(password).toHaveLength(48);
    expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts only the expected credential file shape and target', () => {
    const accounts = ACCOUNT_SPECS.map((spec, index) => ({
      ...spec,
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      password: 'x'.repeat(48),
    }));
    expect(validateCredentials({ schemaVersion: 1, projectRef: EXPECTED_PROJECT_REF, accounts }).accounts).toHaveLength(3);
    expect(() => validateCredentials({ schemaVersion: 1, projectRef: 'wrongprojectref123456', accounts })).toThrow('CREDENTIAL_FILE_INVALID');
    expect(() => validateCredentials({ schemaVersion: 1, projectRef: EXPECTED_PROJECT_REF, accounts: [{ ...accounts[0], role: 'ADMIN' }] })).toThrow('CREDENTIAL_FILE_INVALID');
  });

  it('safely round-trips partial credentials so a later account failure retains its password', async () => {
    const { root, directory } = await createTemporaryDirectory('yru-auth-contract-');
    const path = join(directory, 'credentials.json');
    const spec = ACCOUNT_SPECS[0];
    try {
      const pending = {
        schemaVersion: 1 as const,
        projectRef: EXPECTED_PROJECT_REF,
        accounts: [],
        pending: { ...spec, password: 'x'.repeat(48) },
      };
      await writeCredentials(pending, path);
      expect(await readCredentials(path)).toEqual(pending);

      const saved = {
        schemaVersion: 1 as const,
        projectRef: EXPECTED_PROJECT_REF,
        accounts: [{ ...spec, id: '10000000-0000-4000-8000-000000000001', password: pending.pending.password }],
      };
      await writeCredentials(saved, path);
      expect(await readCredentials(path)).toEqual(saved);
    } finally {
      await removeTemporaryDirectory(root, directory);
    }
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('refuses credentials with an explicit Users read ACE without exposing file content', async () => {
    const { root, directory } = await createTemporaryDirectory('yru-auth-acl-contract-');
    const path = join(directory, 'credentials.json');
    const fakeValue = 'dummy-test-credential-value-never-log';
    const account = ACCOUNT_SPECS[0];
    try {
      await writeCredentials({
        schemaVersion: 1,
        projectRef: EXPECTED_PROJECT_REF,
        accounts: [{ ...account, id: '10000000-0000-4000-8000-000000000001', password: fakeValue.padEnd(48, 'x') }],
      }, path);
      await execFileAsync('icacls.exe', [path, '/grant', '*S-1-5-32-545:(R)'], { windowsHide: true });

      let failureMessage = 'NO_REJECTION';
      try {
        await readCredentials(path);
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : 'UNKNOWN_FAILURE';
      }
      expect(failureMessage).toBe('CREDENTIAL_FILE_UNREADABLE');
      expect(failureMessage).not.toContain(fakeValue);
    } finally {
      await removeTemporaryDirectory(root, directory);
    }
  }, 30_000);

  it('never treats a changed staff profile as safe to reuse', () => {
    const spec = ACCOUNT_SPECS[1];
    const profile = {
      id: '10000000-0000-4000-8000-000000000002',
      department_id: 'department-it',
      role: 'STAFF',
      display_name: spec.displayName,
      active: true,
      can_view_sensitive: false,
      can_view_restricted: false,
    };
    expect(profileMatches(profile, spec, 'department-it')).toBe(true);
    expect(profileMatches({ ...profile, role: 'ADMIN' }, spec, 'department-it')).toBe(false);
    expect(profileMatches({ ...profile, department_id: 'department-library' }, spec, 'department-it')).toBe(false);
  });
});
