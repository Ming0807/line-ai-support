import 'dotenv/config';
import { Pool } from 'pg';
import { updateModel } from '../../lib/ai/provider-admin';

const MODEL_ID = 'faed07d5-8e7d-4a83-925b-4460ac59d0b0';
const NEW_TIMEOUT_MS = 25000;

async function main() {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const admin = (await pool.query(
      "select id from public.staff_profiles where role='SUPER_ADMIN' and active order by created_at limit 1"
    )).rows[0];
    if (!admin) throw new Error('NO_ACTIVE_SUPER_ADMIN');
    const row = (await pool.query(
      `select m.model_id,m.display_name,m.purpose,m.embedding_dimensions,m.supports_tools,m.supports_json,
              m.supports_vision,m.enabled,m.priority,m.timeout_ms,m.input_price_per_million,m.output_price_per_million,m.revision,
              p.id as provider_id
       from private.ai_models m join private.ai_providers p on p.id=m.provider_id where m.id=$1`,
      [MODEL_ID]
    )).rows[0];
    if (!row) throw new Error('MODEL_NOT_FOUND');
    console.log(JSON.stringify({ stage: 'before', timeoutMs: row.timeout_ms, revision: row.revision, providerId: row.provider_id, staffId: admin.id }));
    if (row.timeout_ms === NEW_TIMEOUT_MS) {
      console.log(JSON.stringify({ stage: 'unchanged', timeoutMs: row.timeout_ms }));
      return;
    }
    const changed = await updateModel(admin.id, row.provider_id, MODEL_ID, {
      modelId: row.model_id,
      displayName: row.display_name,
      purpose: row.purpose,
      embeddingDimensions: row.embedding_dimensions,
      supportsTools: row.supports_tools,
      supportsJson: row.supports_json,
      supportsVision: row.supports_vision,
      enabled: row.enabled,
      priority: row.priority,
      timeoutMs: NEW_TIMEOUT_MS,
      inputPricePerMillion: row.input_price_per_million,
      outputPricePerMillion: row.output_price_per_million,
      revision: row.revision,
    }, { pool });
    const after = (await pool.query('select timeout_ms, revision from private.ai_models where id=$1', [MODEL_ID])).rows[0];
    console.log(JSON.stringify({ stage: 'after', ...changed, timeoutMs: after.timeout_ms, revision: after.revision }));
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
