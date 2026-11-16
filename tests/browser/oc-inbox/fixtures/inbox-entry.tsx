/**
 * Fixture entry (tests-only): mounts the REAL production Inbox client component
 * with synthetic same-contract adapters (next/link, next/navigation, fetch shim,
 * Supabase channel fixture). No production code path is modified by this file.
 */
import {createRoot} from 'react-dom/client';
import {fixtureElement} from '../fixtures/fixture-common';
import Inbox from '../../../../app/(dashboard)/inbox/inbox';

const boot = JSON.parse(fixtureElement('fixture-boot').textContent || '{}');

const root = createRoot(fixtureElement('fixture-root'));
root.render(
  <Inbox
    actorId={boot.actorId ?? 'staff-fixture-a'}
    initialTicketId={boot.initialTicketId ?? null}
    initialParams={boot.initialParams ?? {}}
  />,
);
