import { describe, expect, it } from 'vitest';
import {
  nextTicketStatus,
  type TicketAction,
  type TicketStatus,
} from '../lib/conversation/state-machine';

const statuses: TicketStatus[] = [
  'NEW',
  'AI_HANDLING',
  'WAITING_STAFF',
  'STAFF_HANDLING',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
];

const actions: TicketAction[] = [
  'ACCEPT',
  'STAFF_REPLY',
  'USER_REPLY',
  'RESOLVE',
  'CLOSE',
  'REOPEN',
  'REASSIGN',
];

const allowed: Partial<Record<TicketStatus, Partial<Record<TicketAction, TicketStatus>>>> = {
  WAITING_STAFF: {
    ACCEPT: 'STAFF_HANDLING',
  },
  STAFF_HANDLING: {
    STAFF_REPLY: 'WAITING_USER',
    RESOLVE: 'RESOLVED',
    REASSIGN: 'STAFF_HANDLING',
  },
  WAITING_USER: {
    USER_REPLY: 'STAFF_HANDLING',
    REASSIGN: 'WAITING_USER',
  },
  RESOLVED: {
    CLOSE: 'CLOSED',
  },
  CLOSED: {
    REOPEN: 'WAITING_STAFF',
  },
};

describe('ticket pure state machine', () => {
  it('matches the complete allowed and rejected status/action matrix', () => {
    for (const status of statuses) {
      for (const action of actions) {
        const expected = allowed[status]?.[action] ?? null;
        expect(nextTicketStatus(status, action), status + ' + ' + action).toBe(expected);
      }
    }
  });

  it('allows reassign only after acceptance so WAITING_STAFF remains accept-able', () => {
    expect(nextTicketStatus('WAITING_STAFF', 'REASSIGN')).toBeNull();
    expect(nextTicketStatus('STAFF_HANDLING', 'REASSIGN')).toBe('STAFF_HANDLING');
    expect(nextTicketStatus('WAITING_USER', 'REASSIGN')).toBe('WAITING_USER');
    expect(nextTicketStatus('NEW', 'REASSIGN')).toBeNull();
    expect(nextTicketStatus('AI_HANDLING', 'REASSIGN')).toBeNull();
    expect(nextTicketStatus('RESOLVED', 'REASSIGN')).toBeNull();
    expect(nextTicketStatus('CLOSED', 'REASSIGN')).toBeNull();
    expect(nextTicketStatus('CANCELLED', 'REASSIGN')).toBeNull();
  });

  it('does not silently resume RESOLVED, CLOSED, or CANCELLED tickets', () => {
    expect(nextTicketStatus('RESOLVED', 'USER_REPLY')).toBeNull();
    expect(nextTicketStatus('RESOLVED', 'REOPEN')).toBeNull();
    expect(nextTicketStatus('CLOSED', 'USER_REPLY')).toBeNull();
    expect(nextTicketStatus('CANCELLED', 'USER_REPLY')).toBeNull();
    for (const action of actions) {
      expect(nextTicketStatus('CANCELLED', action)).toBeNull();
    }
  });
});
