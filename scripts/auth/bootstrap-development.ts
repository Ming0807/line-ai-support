import 'dotenv/config';
import { Pool } from 'pg';
import { databaseConnection } from '../../lib/database/connection';
import {
  ACCOUNT_SPECS,
  CREDENTIALS_PATH,
  EXPECTED_PROJECT_REF,
  acquireLock,
  createAdminClient,
  createPublicClient,
  developmentConfig,
  generatePassword,
  profileMatches,
  readCredentials,
  validateCredentials,
  writeCredentials,
  type SavedAccount,
  type CredentialDocument,
} from './common';

type ListedAuthUser = { id: string; email?: string };

function fail(code: string): never {
  throw new Error(code);
}

async function listAllUsers(admin: ReturnType<typeof createAdminClient>): Promise<ListedAuthUser[]> {
  const users: ListedAuthUser[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail('AUTH_USER_LIST_FAILED');
    users.push(...data.users.map(({ id, email }) => ({ id, email })));
    if (data.users.length < 1000) return users;
  }
}

async function checkedAccount(
  admin: ReturnType<typeof createAdminClient>,
  account: SavedAccount,
): Promise<ListedAuthUser> {
  const { data, error } = await admin.auth.admin.getUserById(account.id);
  if (error || !data.user || data.user.email?.toLowerCase() !== account.email) fail('RECORDED_AUTH_ACCOUNT_MISMATCH');
  return { id: data.user.id, email: data.user.email };
}

async function recoverPendingAccount(
  publicClient: ReturnType<typeof createPublicClient>,
  email: string,
  password: string,
): Promise<ListedAuthUser | null> {
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
  if (error || !data.user || data.user.email?.toLowerCase() !== email) return null;
  await publicClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return { id: data.user.id, email: data.user.email };
}

async function ensureProfile(pool: Pool, account: SavedAccount): Promise<void> {
  const spec = ACCOUNT_SPECS.find(({ email }) => email === account.email);
  if (!spec || spec.role !== account.role || spec.departmentCode !== account.departmentCode) fail('ACCOUNT_SPEC_MISMATCH');

  const current = await pool.query(
    `select id, department_id, role, display_name, active, can_view_sensitive, can_view_restricted
       from public.staff_profiles where id=$1`,
    [account.id],
  );
  let departmentId: string | null = null;
  if (spec.departmentCode) {
    const department = await pool.query('select id from public.departments where code=$1 and active', [spec.departmentCode]);
    if (department.rowCount !== 1) fail('EXPECTED_DEPARTMENT_MISSING');
    departmentId = department.rows[0].id as string;
  }

  if (current.rowCount) {
    if (current.rowCount !== 1 || current.rows[0].id !== account.id || !profileMatches(current.rows[0], spec, departmentId)) fail('EXISTING_STAFF_PROFILE_MISMATCH');
    return;
  }

  await pool.query(
    `insert into public.staff_profiles
       (id, department_id, display_name, role, active, can_view_sensitive, can_view_restricted)
     values ($1,$2,$3,$4,true,false,false)`,
    [account.id, departmentId, spec.displayName, spec.role],
  );
}

async function runBootstrap(): Promise<void> {
  const config = developmentConfig(process.env, true);
  const admin = createAdminClient(config);
  const publicClient = createPublicClient(config);
  const releaseLock = await acquireLock();
  let pool: Pool | undefined;
  try {
    let document: CredentialDocument | null = await readCredentials(CREDENTIALS_PATH);
    const hadCredentialFile = document !== null;
    if (document && document.projectRef !== EXPECTED_PROJECT_REF) fail('CREDENTIAL_FILE_PROJECT_MISMATCH');
    document ??= { schemaVersion: 1, projectRef: EXPECTED_PROJECT_REF, accounts: [] };
    document = validateCredentials(document);
    if (!hadCredentialFile) await writeCredentials(document, CREDENTIALS_PATH);

    pool = new Pool(databaseConnection(config.directUrl));
    await pool.query(`select 1 from public.staff_profiles limit 0`);
    const departments = await pool.query(
      `select code from public.departments where active and code=any($1::text[])`,
      [['IT', 'LIBRARY']],
    );
    if (!['IT', 'LIBRARY'].every((code) => departments.rows.some((row) => row.code === code))) fail('EXPECTED_DEPARTMENTS_MISSING');

    const authUsers = await listAllUsers(admin);
    for (const spec of ACCOUNT_SPECS) {
      let account: SavedAccount | undefined = document.accounts.find((saved) => saved.email === spec.email);
      if (account) {
        await checkedAccount(admin, account);
      } else {
        if (document.pending && document.pending.email !== spec.email) fail('UNRESOLVED_PENDING_ACCOUNT');
        const pending: NonNullable<CredentialDocument['pending']> = document.pending ?? {
          email: spec.email,
          password: generatePassword(),
          role: spec.role,
          departmentCode: spec.departmentCode,
          displayName: spec.displayName,
        };
        if (!document.pending) {
          if (authUsers.some((user) => user.email?.toLowerCase() === spec.email)) fail('UNRECORDED_AUTH_ACCOUNT_EXISTS');
          document = { ...document, pending };
          await writeCredentials(document, CREDENTIALS_PATH);
        }

        let recovered: ListedAuthUser | null = null;
        if (authUsers.some((user) => user.email?.toLowerCase() === spec.email)) {
          recovered = await recoverPendingAccount(publicClient, spec.email, pending.password);
          if (!recovered) fail('PENDING_ACCOUNT_CANNOT_BE_VERIFIED');
        }

        let authUser = recovered;
        if (!authUser) {
          const { data, error } = await admin.auth.admin.createUser({
            email: spec.email,
            password: pending.password,
            email_confirm: true,
          });
          if (error || !data.user) fail('AUTH_USER_CREATE_FAILED');
          authUser = { id: data.user.id, email: data.user.email };
        }
        if (!authUser.email || authUser.email.toLowerCase() !== spec.email) fail('AUTH_USER_CREATE_RESPONSE_INVALID');
        account = {
          ...pending,
          id: authUser.id,
        };
        document = {
          schemaVersion: 1,
          projectRef: EXPECTED_PROJECT_REF,
          accounts: [...document.accounts, account],
        };
        await writeCredentials(document, CREDENTIALS_PATH);
        authUsers.push(authUser);
        console.info(`[auth-bootstrap] auth_account=created role=${spec.role}`);
      }

      await ensureProfile(pool, account);
      console.info(`[auth-bootstrap] staff_profile=verified role=${spec.role}`);
    }

    if (document.pending || document.accounts.length !== ACCOUNT_SPECS.length) fail('BOOTSTRAP_INCOMPLETE');
    console.info('[auth-bootstrap] complete accounts=3 profiles=3 target=verified');
  } finally {
    await pool?.end().catch(() => undefined);
    await releaseLock();
    await publicClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}

runBootstrap().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNEXPECTED_FAILURE';
  console.error(`[auth-bootstrap] failed code=${code}`);
  process.exitCode = 1;
});
