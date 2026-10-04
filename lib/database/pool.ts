import { Pool, type PoolClient } from 'pg';
import { databaseConnection } from './connection';

let applicationPool: Pool | undefined;
export function getDatabasePool(): Pool {
 if (applicationPool) return applicationPool;
 const connectionString=process.env.DATABASE_URL;
 if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
 applicationPool=new Pool({...databaseConnection(connectionString),max:1,idleTimeoutMillis:30_000});
 return applicationPool;
}

export async function transaction<T>(work:(client:PoolClient)=>Promise<T>,pool=getDatabasePool()):Promise<T> {
 const client=await pool.connect();
 try {
  await client.query('begin');
  const result=await work(client);
  await client.query('commit');
  return result;
 } catch(error) {
  await client.query('rollback');
  throw error;
 } finally { client.release(); }
}
