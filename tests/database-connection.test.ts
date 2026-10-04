import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { databaseConnection } from '../lib/database/connection';
import { Client } from 'pg';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

describe('database TLS trust', () => {
  beforeEach(() => vi.stubEnv('DATABASE_SSL_CA_PATH', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('requires certificate verification for remote servers by default', () => {
    expect(databaseConnection('postgresql://example.invalid:5432/postgres').ssl)
      .toEqual({ rejectUnauthorized: true });
  });

  it('does not let connection-string SSL options disable verification', () => {
    const options = databaseConnection('postgresql://example.invalid:5432/postgres?sslmode=disable&sslrootcert=untrusted&pgbouncer=true');
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.connectionString).toBe('postgresql://example.invalid:5432/postgres');
  });

  it.each(['ssl=false', 'ssl=no-verify', 'sslmode=no-verify&uselibpqcompat=true'])
    ('keeps the pg driver strict despite URL option %s', query => {
      const client = new Client(databaseConnection(`postgresql://example.invalid/postgres?${query}`));
      expect(client.ssl).toEqual({ rejectUnauthorized: true });
    });

  it('uses an explicitly configured CA with verification enabled', () => {
    vi.stubEnv('DATABASE_SSL_CA_PATH', '/configured/ca.pem');
    vi.mocked(readFileSync).mockReturnValue('trusted CA');
    expect(databaseConnection('postgresql://example.invalid/postgres').ssl)
      .toEqual({ rejectUnauthorized: true, ca: 'trusted CA' });
    expect(readFileSync).toHaveBeenCalledWith('/configured/ca.pem', 'utf8');
  });

  it('fails closed when the configured CA cannot be read', () => {
    vi.stubEnv('DATABASE_SSL_CA_PATH', '/missing/ca.pem');
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('CA_UNAVAILABLE'); });
    expect(() => databaseConnection('postgresql://example.invalid/postgres'))
      .toThrow('CA_UNAVAILABLE');
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('permits the explicit local development host %s', host => {
    expect(databaseConnection(`postgresql://${host}:54422/postgres`).ssl).toBe(false);
  });
});
