import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { databaseConnection } from './connection';

export function createDatabasePool(connectionString:string,options:Pick<PoolConfig,'max'|'idleTimeoutMillis'>={}):Pool {
 const pool=new Pool({...databaseConnection(connectionString),...options});
 // pg-pool removes its idle listener while a client is checked out. A socket
 // failure between queries must not become an uncaught EventEmitter error.
 // pg still rejects queries and marks the connection unusable; never replay work.
 const failedClients=new WeakSet<PoolClient>();
 function connectionError(this:PoolClient){
  if(!failedClients.has(this)){failedClients.add(this);console.error('DATABASE_CLIENT_CONNECTION_ERROR');}
 }
 pool.on('acquire',client=>{client.on('error',connectionError);});
 pool.on('release',(_error,client)=>{client.removeListener('error',connectionError);});
 // pg removes the failed idle client before emitting this event. Never log its
 // attached error/client: later queries can establish a fresh connection.
 pool.on('error',()=>{console.error('DATABASE_POOL_IDLE_ERROR');});
 return pool;
}

let applicationPool: Pool | undefined;
export function getDatabasePool(): Pool {
 if (applicationPool) return applicationPool;
 const connectionString=process.env.DATABASE_URL;
 if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
 applicationPool=createDatabasePool(connectionString,{max:1,idleTimeoutMillis:30_000});
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
