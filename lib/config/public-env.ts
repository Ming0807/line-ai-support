export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

/** Read statically named public variables so Next can inline them into browser bundles. */
export function readPublicEnv(source?: Record<string, string | undefined>): PublicEnv {
  const values = source ?? {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  return {
    supabaseUrl: values.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '',
    supabasePublishableKey:
      values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      values.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
      '',
  };
}
