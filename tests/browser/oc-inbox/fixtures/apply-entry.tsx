/**
 * Fixture entry (tests-only): mounts the REAL staff onboarding apply client
 * (~ app/staff/apply/apply-client.tsx) under the fixture fetch shim.
 */
import {createRoot} from 'react-dom/client';
import {fixtureElement} from '../fixtures/fixture-common';
import ApplyClient from '../../../../app/staff/apply/apply-client';

const root = createRoot(fixtureElement('fixture-root'));
root.render(<ApplyClient />);
