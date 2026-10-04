import type { ConnectionConfig } from 'pg';
import { readFileSync } from 'node:fs';

/** Remote connections always verify TLS; a configured CA augments the trust source. */
export function databaseConnection(connectionString:string):ConnectionConfig {
 const target=new URL(connectionString);
 const local=['localhost','127.0.0.1','::1','[::1]'].includes(target.hostname);
 for(const flag of ['pgbouncer','ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) target.searchParams.delete(flag);
 const caPath=process.env.DATABASE_SSL_CA_PATH;
 return {connectionString:target.toString(),
  ssl:local?false:caPath?{rejectUnauthorized:true,ca:readFileSync(caPath,'utf8')}:{rejectUnauthorized:true},
  connectionTimeoutMillis:10_000,statement_timeout:15_000};
}
