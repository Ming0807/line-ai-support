import {readServerEnv} from '../config/env';
import {trustedLineCallbackUrl} from './line-staff-flow';

/** Explicit operator confirmation is required before equating Login and OA subjects.
 * These flags contain no provider credential; Supabase owns the Login secret. */
export function readStaffLineConfig(source:NodeJS.ProcessEnv=process.env):{loginAvailable:boolean;sameProviderConfirmed:boolean} {
 const env=readServerEnv(source),sameProviderConfirmed=source.LINE_STAFF_SAME_PROVIDER_CONFIRMED==='true';
 return {sameProviderConfirmed,loginAvailable:source.LINE_STAFF_LOGIN_ENABLED==='true'&&sameProviderConfirmed&&
  !!env.encryptionKey&&!!env.supabaseUrl&&!!env.supabasePublishableKey&&trustedLineCallbackUrl(env.appBaseUrl)!==null};
}
