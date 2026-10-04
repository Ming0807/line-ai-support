'use client';

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';
import { readPublicEnv } from '@/lib/config/public-env';

export function createBrowserClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase is not configured.');
  }
  return createSsrBrowserClient(supabaseUrl, supabasePublishableKey);
}
