'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
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
    await supabase.auth.signOut();
  } finally {
    redirect('/login');
  }
}
