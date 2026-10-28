import { describe, expect, it } from 'vitest';
import {
  incidentBatchSelectAllEligible,
  incidentBatchClearSelection,
} from '../app/(dashboard)/incidents/IncidentBatchReply';
import type { IncidentReplyOption } from '../lib/incidents/batch-reply-contracts';

function option(ticketId: string, eligibility: IncidentReplyOption['eligibility']): IncidentReplyOption {
  return {
    ticketId,
    ticketCode: `YRU-${ticketId}`,
    reporterLabel: 'ผู้รายงาน R1',
    status: 'STAFF_HANDLING',
    eligibility,
    pendingUserMessages: 0,
  };
}

describe('incident batch selection controls', () => {
  it('adds only currently selectable cases and preserves already selected cases', () => {
    const items = [
      option('own', 'OWN_CASE'),
      option('intervention', 'INTERVENTION_REQUIRED'),
      option('other', 'OTHER_ASSIGNEE'),
      option('unassigned', 'UNASSIGNED'),
      option('private', 'PRIVATE_CASE'),
    ];

    expect(incidentBatchSelectAllEligible(['stale-selected'], items, false, false))
      .toEqual(['stale-selected', 'own']);
    expect(incidentBatchSelectAllEligible(['stale-selected'], items, true, true))
      .toEqual(['stale-selected', 'own', 'intervention']);
  });

  it('caps additions at 100 without discarding an existing selection', () => {
    const existing = Array.from({ length: 99 }, (_, index) => `selected-${index}`);
    const items = [option('first-current', 'OWN_CASE'), option('second-current', 'OWN_CASE')];

    expect(incidentBatchSelectAllEligible(existing, items, false, false))
      .toEqual([...existing, 'first-current']);
    expect(incidentBatchSelectAllEligible([...existing, 'one-hundredth'], items, false, false))
      .toEqual([...existing, 'one-hundredth']);
  });

  it('supports one-case selection mode without trimming a prior multi-case choice', () => {
    const items = [option('new-first', 'OWN_CASE'), option('new-second', 'OWN_CASE')];

    expect(incidentBatchSelectAllEligible(['kept-a', 'kept-b'], items, false, false, 1))
      .toEqual(['kept-a', 'kept-b']);
    expect(incidentBatchSelectAllEligible([], items, false, false, 1)).toEqual(['new-first']);
  });

  it('clears only after the explicit clear-selection action', () => {
    expect(incidentBatchClearSelection()).toEqual([]);
  });
});
