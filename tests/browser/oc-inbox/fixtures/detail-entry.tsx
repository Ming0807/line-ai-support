/**
 * Fixture entry (tests-only): mounts the REAL detail-route bridge
 * (ChatThreadLive) exactly like the production
 * `app/(dashboard)/tickets/[id]/page.tsx` layout does (SSR-seeded thread;
 * the bridge itself owns the conversation section, the lifecycle actions and
 * the lifetime wiring). No production module is modified by this file.
 */
import {createRoot} from 'react-dom/client';
import {fixtureElement} from '../fixtures/fixture-common';
import ChatThreadLive from '../../../../app/(dashboard)/tickets/[id]/chat-thread-live';

const boot = JSON.parse(fixtureElement('fixture-boot').textContent || '{}');
const initialThread = boot.initialThread;

const root = createRoot(fixtureElement('fixture-root'));

const ticket = initialThread.detail.ticket;

// Test-only control (S10): unmount the React root in this same document so the
// cleanup effects (Supabase channel removal) can be observed. A full navigation
// would wipe the per-document supabase fixture and its bookkeeping.
const unmountButton = document.createElement('button');
unmountButton.setAttribute('data-fixture', 'unmount');
unmountButton.textContent = 'UNMOUNT-FIXTURE';
document.body.appendChild(unmountButton);
unmountButton.addEventListener('click', () => { root.unmount(); });

root.render(
  <div className="ticket-page ticket-detail-page">
    <header className="ticket-detail-header">
      <div className="ticket-detail-title"><h1>{ticket.problem_summary}</h1></div>
    </header>
    <div className="ticket-detail-grid">
      <div className="ticket-detail-main">
        <ChatThreadLive actorId={boot.actorId ?? 'staff-fixture-a'} ticketId={ticket.id} initialThread={initialThread} />
      </div>
    </div>
  </div>,
);
