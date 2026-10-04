import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertDevelopmentTarget } from '../../lib/database/development-target';

export const EXPECTED_PROJECT_REF = 'tqgbodenouvcwepoxwbu';
export const CREDENTIALS_PATH = resolve('.superpowers/staging/dev-staff-credentials.json');
export const LOCK_PATH = `${CREDENTIALS_PATH}.lock`;

export type AccountSpec = {
  email: string;
  role: 'SUPER_ADMIN' | 'STAFF';
  departmentCode: 'IT' | 'LIBRARY' | null;
  displayName: string;
};

export const ACCOUNT_SPECS: readonly AccountSpec[] = [
  { email: 'admin@yru-helpdesk.test', role: 'SUPER_ADMIN', departmentCode: null, displayName: 'Development Admin' },
  { email: 'it@yru-helpdesk.test', role: 'STAFF', departmentCode: 'IT', displayName: 'Development IT Staff' },
  { email: 'library@yru-helpdesk.test', role: 'STAFF', departmentCode: 'LIBRARY', displayName: 'Development Library Staff' },
];

export type SavedAccount = { id: string; email: string; password: string; role: AccountSpec['role']; departmentCode: AccountSpec['departmentCode']; displayName: string };
export type CredentialDocument = {
  schemaVersion: 1;
  projectRef: string;
  accounts: SavedAccount[];
  pending?: Omit<SavedAccount, 'id'>;
};

export type DevelopmentConfig = {
  projectRef: string;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  directUrl: string;
};

export function developmentConfig(source: Record<string, string | undefined> = process.env, requireAdmin = false): DevelopmentConfig {
  const config = {
    projectRef: source.DEV_SUPABASE_PROJECT_REF ?? '',
    supabaseUrl: source.NEXT_PUBLIC_SUPABASE_URL ?? source.SUPABASE_URL ?? '',
    publishableKey: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ?? source.SUPABASE_PUBLISHABLE_KEY
      ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ?? source.SUPABASE_ANON_KEY
      ?? '',
    secretKey: source.SUPABASE_SECRET_KEY ?? source.SUPABASE_SERVICE_ROLE_KEY ?? '',
    directUrl: source.DIRECT_URL ?? source.SUPABASE_DIRECT_DATABASE_URL ?? '',
  };

  assertDevelopmentTarget({
    environment: source.YRU_DEPLOYMENT_ENV,
    projectRef: config.projectRef,
    supabaseUrl: config.supabaseUrl,
    directUrl: config.directUrl,
  }, EXPECTED_PROJECT_REF);
  if (!config.publishableKey) throw new Error('DEVELOPMENT_PUBLIC_KEY_MISSING');
  if (requireAdmin && !config.secretKey) throw new Error('DEVELOPMENT_ADMIN_KEY_MISSING');
  return config;
}

export function createPublicClient(config: Pick<DevelopmentConfig, 'supabaseUrl' | 'publishableKey'>) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export function createAdminClient(config: Pick<DevelopmentConfig, 'supabaseUrl' | 'secretKey'>) {
  return createClient(config.supabaseUrl, config.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export function generatePassword(): string {
  return randomBytes(36).toString('base64url');
}

export function profileMatches(
  profile: Record<string, unknown> | null,
  spec: AccountSpec,
  departmentId: string | null,
): boolean {
  return profile !== null
    && profile.role === spec.role
    && profile.department_id === departmentId
    && profile.display_name === spec.displayName
    && profile.active === true
    && profile.can_view_sensitive === false
    && profile.can_view_restricted === false;
}

export function validateCredentials(value: unknown, projectRef = EXPECTED_PROJECT_REF): CredentialDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CREDENTIAL_FILE_INVALID');
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || source.projectRef !== projectRef || !Array.isArray(source.accounts)) {
    throw new Error('CREDENTIAL_FILE_INVALID');
  }
  const accounts: SavedAccount[] = [];
  for (const account of source.accounts as unknown[]) {
    if (!account || typeof account !== 'object') {
      throw new Error('CREDENTIAL_FILE_INVALID');
    }
    const record = account as Record<string, unknown>;
    const spec = ACCOUNT_SPECS.find((item) => item.email === record.email);
    if (Object.keys(record).some((key) => !['id', 'email', 'password', 'role', 'departmentCode', 'displayName'].includes(key))) {
      throw new Error('CREDENTIAL_FILE_INVALID');
    }
    if (typeof record.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)
      || typeof record.password !== 'string' || record.password.length < 32 || record.password.length > 128
      || !spec || record.role !== spec.role || record.departmentCode !== spec.departmentCode || record.displayName !== spec.displayName) {
      throw new Error('CREDENTIAL_FILE_INVALID');
    }
    if (accounts.some((item) => item.email === spec.email || item.id === record.id)) throw new Error('CREDENTIAL_FILE_INVALID');
    accounts.push({ id: record.id, email: spec.email, password: record.password, role: spec.role, departmentCode: spec.departmentCode, displayName: spec.displayName });
  }
  let pending: CredentialDocument['pending'];
  if (source.pending !== undefined) {
    if (!source.pending || typeof source.pending !== 'object') throw new Error('CREDENTIAL_FILE_INVALID');
    const record = source.pending as Record<string, unknown>;
    const spec = ACCOUNT_SPECS.find((item) => item.email === record.email);
    if (Object.keys(record).some((key) => !['email', 'password', 'role', 'departmentCode', 'displayName'].includes(key))) {
      throw new Error('CREDENTIAL_FILE_INVALID');
    }
    if (!spec || typeof record.password !== 'string' || record.password.length < 32 || record.password.length > 128
      || record.role !== spec.role || record.departmentCode !== spec.departmentCode || record.displayName !== spec.displayName
      || accounts.some((item) => item.email === spec.email)) throw new Error('CREDENTIAL_FILE_INVALID');
    pending = { email: spec.email, password: record.password, role: spec.role, departmentCode: spec.departmentCode, displayName: spec.displayName };
  }
  if (Object.keys(source).some((key) => !['schemaVersion', 'projectRef', 'accounts', 'pending'].includes(key))) {
    throw new Error('CREDENTIAL_FILE_INVALID');
  }
  return { schemaVersion: 1, projectRef, accounts, ...(pending ? { pending } : {}) };
}

export async function readCredentials(path = CREDENTIALS_PATH): Promise<CredentialDocument | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('CREDENTIAL_FILE_INVALID');
    await restrictCredentialFile(path);
    const raw = await readFile(path, 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('CREDENTIAL_FILE_INVALID'); }
    return validateCredentials(parsed);
  } catch (error) {
    if (isMissingFile(error)) return null;
    if (error instanceof Error && error.message === 'CREDENTIAL_FILE_INVALID') throw error;
    throw new Error('CREDENTIAL_FILE_UNREADABLE');
  }
}

const execFileAsync=promisify(execFile);
async function restrictCredentialFile(path:string):Promise<void> {
  try {
    if(process.platform==='win32') {
      const {stdout}=await execFileAsync('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true});
      const sid=stdout.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
      if(!sid) throw new Error('CREDENTIAL_FILE_ACL_FAILED');
      // Scope the change to this file, then fail closed on any remaining explicit
      // ACE for another SID. Never assume /grant:r removes unrelated explicit ACEs.
      await execFileAsync('icacls.exe',[path,'/inheritance:r','/grant:r',`*${sid}:(F)`,'*S-1-5-18:(F)'],{windowsHide:true});
      const command=`$ErrorActionPreference='Stop';
        $acl=Get-Acl -LiteralPath $env:YRU_CREDENTIAL_FILE_PATH;
        $allowed=@($env:YRU_CREDENTIAL_OWNER_SID,'S-1-5-18');
        $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;
        if($owner -notin $allowed) {exit 2};
        if(-not $acl.AreAccessRulesProtected -or $acl.Access.Count -ne 2) {exit 2};
        foreach($rule in $acl.Access) {
          $principal=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;
          if($principal -notin $allowed -or $rule.IsInherited -or
             $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') {exit 2};
        }`;
      // A PowerShell7 parent may export its own incompatible module path.
      const psEnv:NodeJS.ProcessEnv={...process.env};
      for(const key of Object.keys(psEnv)) if(key.toLowerCase()==='psmodulepath') delete psEnv[key];
      await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{
        windowsHide:true,env:{...psEnv,
          PSModulePath:resolve(process.env.SystemRoot ?? 'C:/Windows','System32/WindowsPowerShell/v1.0/Modules'),
          YRU_CREDENTIAL_OWNER_SID:sid,YRU_CREDENTIAL_FILE_PATH:path},
      });
    } else {await chmod(path,0o600);}
  } catch {throw new Error('CREDENTIAL_FILE_ACL_FAILED');}
}

export async function writeCredentials(document: CredentialDocument, path = CREDENTIALS_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let handle;
  try {
    // Seal an empty file before writing any credential bytes, then atomically replace.
    handle=await open(tempPath,'wx',0o600);
    await restrictCredentialFile(tempPath);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`,'utf8');
    await handle.close(); handle=undefined;
    await rename(tempPath, path);
  } catch {
    await handle?.close().catch(()=>undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error('CREDENTIAL_FILE_WRITE_FAILED');
  }
}

export async function acquireLock(path = LOCK_PATH): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch {
    throw new Error('BOOTSTRAP_ALREADY_RUNNING_OR_STALE_LOCK');
  }
  return async () => {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
  };
}

export function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function hasExpectedAccountSet(document: CredentialDocument): boolean {
  return !document.pending && ACCOUNT_SPECS.every((spec) => document.accounts.some((account) => account.email === spec.email));
}

export type PublicAuthClient = ReturnType<typeof createPublicClient>;
export type AdminAuthClient = ReturnType<typeof createAdminClient>;
export type AnySupabaseClient = SupabaseClient;
