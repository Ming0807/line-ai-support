import { LoginForm } from './login-form';
import { safeRedirectTarget } from '@/lib/auth/redirect';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const denied = params.error === 'access_denied';
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <main className="page-shell login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">มหาวิทยาลัยราชภัฏยะลา</p>
        <h1 id="login-title">ระบบงานบริการบุคลากร</h1>
        <p className="intro">เข้าสู่ระบบด้วยบัญชีบุคลากรเพื่อดูและติดตามงานบริการ</p>
        {denied && <p className="notice" role="status">บัญชีนี้ยังไม่มีสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ</p>}
        {params.error === 'signout_failed' && <p className="notice" role="alert">ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ</p>}
        <LoginForm nextPath={safeRedirectTarget(requestedNext)} />
      </section>
    </main>
  );
}
