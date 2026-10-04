import 'dotenv/config';
import { readCredentials, createPublicClient, developmentConfig, hasExpectedAccountSet, type SavedAccount } from './common';

function fail(code: string): never {
  throw new Error(code);
}

async function verifyAccount(account: SavedAccount, accounts: SavedAccount[], config: ReturnType<typeof developmentConfig>): Promise<void> {
  const client = createPublicClient(config);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (signInError || !signInData.user || signInData.user.id !== account.id) fail('AUTH_SIGN_IN_ASSERTION_FAILED');
  if (signInData.user.user_metadata && 'role' in signInData.user.user_metadata) fail('AUTH_METADATA_ROLE_ASSERTION_FAILED');

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const subject = claimsData?.claims?.sub;
  if (claimsError || typeof subject !== 'string' || subject !== account.id) fail('VERIFIED_CLAIMS_ASSERTION_FAILED');

  const { data: profile, error: profileError } = await client
    .from('staff_profiles')
    .select('id, department_id, role, display_name, active')
    .eq('id', subject)
    .maybeSingle();
  if (profileError || !profile || profile.id !== account.id || profile.role !== account.role
    || profile.display_name !== account.displayName || profile.active !== true) fail('PROFILE_ASSERTION_FAILED');

  if (account.departmentCode) {
    const { data: department, error: departmentError } = await client
      .from('departments')
      .select('id')
      .eq('code', account.departmentCode)
      .maybeSingle();
    if (departmentError || !department || profile.department_id !== department.id) fail('DEPARTMENT_ASSERTION_FAILED');

    const otherDepartmentCode = account.departmentCode === 'IT' ? 'LIBRARY' : 'IT';
    const { data: otherDepartment, error: otherDepartmentError } = await client
      .from('departments')
      .select('id')
      .eq('code', otherDepartmentCode)
      .maybeSingle();
    if (otherDepartmentError || !otherDepartment) fail('CROSS_DEPARTMENT_FIXTURE_ASSERTION_FAILED');
    const { data: otherTickets, error: ticketError } = await client
      .from('tickets')
      .select('id')
      .eq('department_id', otherDepartment.id)
      .limit(1);
    if (ticketError || (otherTickets?.length ?? 0) > 0) fail('CROSS_DEPARTMENT_DENIAL_ASSERTION_FAILED');
  } else if (profile.department_id !== null) {
    fail('ADMIN_DEPARTMENT_ASSERTION_FAILED');
  }

  for (const other of accounts) {
    if (other.id === account.id) continue;
    const { data: otherProfile, error: crossProfileError } = await client
      .from('staff_profiles')
      .select('id')
      .eq('id', other.id)
      .maybeSingle();
    if (crossProfileError || otherProfile !== null) fail('CROSS_PROFILE_DENIAL_ASSERTION_FAILED');
  }

  const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
  if (signOutError) fail('LOCAL_SIGN_OUT_ASSERTION_FAILED');
  const { data: loggedOutClaims, error: loggedOutError } = await client.auth.getClaims();
  if (!loggedOutError && typeof loggedOutClaims?.claims?.sub === 'string') fail('LOGOUT_SESSION_ASSERTION_FAILED');
  console.info(`[auth-api] account_verified role=${account.role}`);
}

async function runVerification(): Promise<void> {
  const config = developmentConfig();
  const credentials = await readCredentials();
  if (!credentials || !hasExpectedAccountSet(credentials)) fail('CREDENTIAL_FILE_INCOMPLETE');

  const anonymous = createPublicClient(config);
  const { data: anonymousClaims, error: anonymousClaimsError } = await anonymous.auth.getClaims();
  if (!anonymousClaimsError && typeof anonymousClaims?.claims?.sub === 'string') fail('UNAUTHENTICATED_CLAIMS_ASSERTION_FAILED');
  const { data: anonymousProfiles, error: anonymousProfileError } = await anonymous
    .from('staff_profiles')
    .select('id')
    .limit(1);
  if (anonymousProfileError && anonymousProfileError.code !== '42501') fail('UNAUTHENTICATED_PROFILE_CHECK_FAILED');
  if (!anonymousProfileError && (anonymousProfiles?.length ?? 0) > 0) fail('UNAUTHENTICATED_PROFILE_DENIAL_ASSERTION_FAILED');
  console.info('[auth-api] unauthenticated_denied assertion=claims_and_profiles');

  for (const account of credentials.accounts) await verifyAccount(account, credentials.accounts, config);
  console.info('[auth-api] complete accounts=3 claims=verified cross_profile=denied cross_department=denied logout=verified');
}

runVerification().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNEXPECTED_FAILURE';
  console.error(`[auth-api] failed code=${code}`);
  process.exitCode = 1;
});
