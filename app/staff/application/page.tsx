import type {Metadata} from 'next';
import StatusClient from './status-client';

export const metadata: Metadata = {title:'สถานะคำขอใช้งานบุคลากร | มหาวิทยาลัยราชภัฏยะลา'};

export default function StaffApplicationStatusPage() {
  return <StatusClient />;
}
