/**
 * Fixture entry (tests-only): mounts the REAL SuperAdmin approvals console
 * (~ app/(dashboard)/staff-applications/approvals-client.tsx) under the fixture
 * fetch shim; boot list is built by the server generator (same contract).
 */
import {createRoot} from 'react-dom/client';
import {fixtureElement} from '../fixtures/fixture-common';
import ApprovalsClient from '../../../../app/(dashboard)/staff-applications/approvals-client';

const root = createRoot(fixtureElement('fixture-root'));
root.render(<ApprovalsClient />);
