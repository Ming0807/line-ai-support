'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { readPublicEnv } from '@/lib/config/public-env';
import { safeRedirectTarget } from '@/lib/auth/redirect';
import { createUserClient } from '@/lib/supabase/server';

export type LoginState = { error?: string };

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function signInAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'กรุณาตรวจสอบอีเมลและรหัสผ่าน' };

  try {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { error: 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง' };
  } catch {
    return { error: 'ระบบเข้าสู่ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ' };
  }

  redirect(safeRedirectTarget(formData.get('next')));
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createUserClient();
    // A returned provider error is compensated by explicit local cookie removal below.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // A provider outage does not prevent removing the current browser's auth cookies.
  }
  try {
    const { supabaseUrl } = readPublicEnv();
    const prefix = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
    const store = await cookies();
    for (const cookie of store.getAll()) {
      if (cookie.name === prefix || (cookie.name.startsWith(`${prefix}.`) && /^\d+$/.test(cookie.name.slice(prefix.length + 1)))) {
        store.delete(cookie.name);
      }
    }
  } catch {
    redirect('/login?error=signout_failed');
  }
  redirect('/login');
}
