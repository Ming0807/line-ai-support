import { redirect } from 'next/navigation';
import { createUserClient } from '@/lib/supabase/server';

export type StaffRole = 'STAFF' | 'SUPERVISOR' | 'ADMIN' | 'SUPER_ADMIN';

export type StaffIdentity = {
  id: string;
  department_id: string | null;
  role: StaffRole;
  display_name: string;
  active: boolean;
  can_view_sensitive: boolean;
  can_view_restricted: boolean;
};

const roles = new Set<StaffRole>(['STAFF', 'SUPERVISOR', 'ADMIN', 'SUPER_ADMIN']);

function denyAccess(): never {
  redirect('/login?error=access_denied');
}

/** Authenticate the subject from a verified token, then resolve its active staff row. */
export async function requireStaff(): Promise<StaffIdentity> {
  let supabase: Awaited<ReturnType<typeof createUserClient>>;
  try {
    supabase = await createUserClient();
  } catch {
    redirect('/login');
  }
  const { data: claimsResult, error: claimsError } = await supabase.auth.getClaims();
  const subject = !claimsError && claimsResult?.claims?.sub;
  if (typeof subject !== 'string' || subject.length === 0) redirect('/login');

  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, department_id, role, display_name, active, can_view_sensitive, can_view_restricted')
    .eq('id', subject)
    .maybeSingle();

  if (
    error ||
    !data ||
    typeof data.id !== 'string' ||
    typeof data.display_name !== 'string' ||
    data.active !== true ||
    !roles.has(data.role as StaffRole)
  ) {
    denyAccess();
  }

  return {
    id: data.id,
    department_id: data.department_id,
    role: data.role as StaffRole,
    display_name: data.display_name,
    active: true,
    can_view_sensitive: data.role === 'SUPER_ADMIN' || data.can_view_sensitive === true,
    can_view_restricted: data.can_view_restricted === true,
  };
}
