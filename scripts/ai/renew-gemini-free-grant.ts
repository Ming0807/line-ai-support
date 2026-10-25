import 'dotenv/config';
import { Pool } from 'pg';
import { saveFreeAccountGrant } from '../../lib/ai/account-free-admin';

const PROVIDER_ID = 'da793713-5217-4df0-a907-16039b830e5d';
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const VALID_FOR_DAYS = 30;

async function main() {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const admin = (await pool.query(
      "select id from public.staff_profiles where role='SUPER_ADMIN' and active order by created_at limit 1"
    )).rows[0];
    if (!admin) throw new Error('NO_ACTIVE_SUPER_ADMIN');
    const grant = (await pool.query(
      'select revision, expires_at, state from private.ai_free_account_grants where provider_id=$1',
      [PROVIDER_ID]
    )).rows[0];
    const provider = (await pool.query(
      'select revision, name from private.ai_providers where id=$1', [PROVIDER_ID]
    )).rows[0];
    console.log(JSON.stringify({ stage: 'before', provider: provider.name, providerRevision: provider.revision, grantRevision: grant?.revision ?? null, grantState: grant?.state ?? null, expiresAt: grant?.expires_at ?? null }));
    const result = await saveFreeAccountGrant(admin.id, PROVIDER_ID, {
      providerRevision: provider.revision,
      grantRevision: grant?.revision ?? -1,
      models: MODELS,
      validForDays: VALID_FOR_DAYS,
      confirmFreeTier: true,
      billingDisabled: true,
    }, { pool });
    const after = (await pool.query(
      'select state, expires_at, revision from private.ai_free_account_grants where provider_id=$1',
      [PROVIDER_ID]
    )).rows[0];
    console.log(JSON.stringify({ stage: 'after', ...result, grantState: after.state, expiresAt: after.expires_at }));
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
