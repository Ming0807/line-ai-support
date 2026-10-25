import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {flushStaffAlerts,staffAlertsInstalled} from '../../lib/incidents/staff-alerts';

/** Only disposable PG acceptance fixtures shorten the real persisted deadline. */
export async function prepareOwnedStaffAlerts(pool:Pool){
 const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
 assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
 assert.equal((await pool.query('select current_database() name')).rows[0].name,database);
 if(await staffAlertsInstalled(pool))await pool.query('update private.incident_rules set alert_debounce_seconds=0 where id=1');
}
/** Exercise the production scheduler after COMMIT, never manufacture a delivery/token. */
export async function releaseOwnedStaffAlerts(pool:Pool,key:string,staffId:string){
 if(!await staffAlertsInstalled(pool))return;
 for(let i=0;i<100;i++){
  const pending=(await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and status='PENDING'",[staffId])).rows[0].n;
  if(pending===0)return;
  await flushStaffAlerts(pool,key,{appBaseUrl:'https://helpdesk.example.edu'});
 }
 assert.fail('OWNED_STAFF_ALERT_RELEASE_BOUND');
}
