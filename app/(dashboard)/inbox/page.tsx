import { requireStaff } from '@/lib/auth/staff';
import Inbox from './inbox';
import '@/app/tickets.css';
import './inbox.css';
import { actorMountKey } from './controller';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const [staff, params] = await Promise.all([requireStaff(), searchParams]);
  const ticket = typeof params.ticket === 'string' ? params.ticket : null;

  return <Inbox key={actorMountKey(staff.id)} actorId={staff.id} initialTicketId={ticket} />;
}
