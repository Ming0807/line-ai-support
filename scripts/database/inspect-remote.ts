import 'dotenv/config';
import { Client } from 'pg';
import { databaseConnection } from '../../lib/database/connection';

// Explicitly read-only inspection. Connection secrets never enter output.
const connection=process.env.DIRECT_URL;
if (!connection) throw new Error('DIRECT_URL_NOT_CONFIGURED');
const client=new Client(databaseConnection(connection));
try {
 await client.connect();
 await client.query('begin read only');
 const version=await client.query('show server_version');
 const tables=await client.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by 1,2");
 console.log(JSON.stringify({serverVersion:version.rows[0].server_version,tables:tables.rows},null,2));
 await client.query('rollback');
} catch(error) {
 console.error('Remote inspection failed:', error instanceof Error && 'code' in error ? error.code : 'CONNECTION_ERROR');
 process.exitCode=1;
} finally { await client.end(); }
