/**
 * Fixture entry (tests-only): mounts the REAL incident batch reply client
 * (~ app/(dashboard)/incidents/IncidentBatchReply.tsx) under the fixture fetch
 * shim. The incident id and the recovery-scope actor id both come from the
 * fixture boot; a UUID actor keeps the session-storage recovery key real.
 */
import {createRoot} from 'react-dom/client';
import {fixtureElement} from '../fixtures/fixture-common';
import IncidentBatchReply from '../../../../app/(dashboard)/incidents/IncidentBatchReply';

const boot = JSON.parse(fixtureElement('fixture-boot').textContent || '{}') as {incidentId?: string; actorId?: string};
const incidentId = (boot.incidentId ?? '33333333-3333-4333-8333-333333333333').toLowerCase();
const actorId = boot.actorId ? boot.actorId.toLowerCase() : undefined;

const root = createRoot(fixtureElement('fixture-root'));
root.render(<IncidentBatchReply incidentId={incidentId} actorId={actorId} />);
