import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { readServerEnv } from '@/lib/config/env';

export async function createUserClient() {
  const { supabaseUrl, supabasePublishableKey } = readServerEnv();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase is not configured.');
  }

  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; the root proxy refreshes sessions.
        }
      },
    },
  });
}
