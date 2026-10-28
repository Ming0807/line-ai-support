import type {Metadata} from 'next';
import ApplyClient from './apply-client';

export const metadata: Metadata = {title:'สมัครใช้งานระบบงานบริการ | มหาวิทยาลัยราชภัฏยะลา'};

export default function StaffApplyPage() {
  return <ApplyClient />;
}
