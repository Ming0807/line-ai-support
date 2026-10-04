type DevelopmentTarget={environment?:string;projectRef?:string;supabaseUrl?:string;directUrl?:string};

export function assertDevelopmentTarget(target:DevelopmentTarget,expectedRef:string):void {
 let valid=false;
 try {
  const web=new URL(target.supabaseUrl??''),database=new URL(target.directUrl??'');
  const direct=database.hostname===`db.${expectedRef}.supabase.co` && database.username==='postgres';
  const pooler=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname)
   && database.username===`postgres.${expectedRef}`;
  // pg connection-string query fields can override authority fields. Only options
  // that databaseConnection and the CLI wrapper explicitly remove are allowed.
  const removedOptions=new Set(['pgbouncer','ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']);
  const safeOptions=!database.hash && [...database.searchParams.keys()].every(key=>removedOptions.has(key));
  valid=target.environment==='development' && /^[a-z]{20}$/.test(expectedRef)
   && target.projectRef===expectedRef && web.origin===`https://${expectedRef}.supabase.co`
   && web.pathname==='/' && !web.search && !web.hash && !web.username && !web.password
   && ['postgres:','postgresql:'].includes(database.protocol) && (direct || pooler)
   && (database.port==='' || database.port==='5432') && database.pathname==='/postgres' && Boolean(database.password) && safeOptions;
 } catch { /* Fail with a bounded code, never echo a connection string. */ }
 if(!valid) throw new Error('DEVELOPMENT_TARGET_MISMATCH');
}
