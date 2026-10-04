'use client';

import { useActionState } from 'react';
import { signInAction, type LoginState } from '@/app/auth/actions';

const initialState: LoginState = {};

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action}>
      <input type="hidden" name="next" value={nextPath} />
      <label className="form-field">
        อีเมลบุคลากร
        <input name="email" type="email" autoComplete="username" required maxLength={254} />
      </label>
      <label className="form-field">
        รหัสผ่าน
        <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </label>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </button>
    </form>
  );
}
