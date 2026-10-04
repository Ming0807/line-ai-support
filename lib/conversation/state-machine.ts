export type TicketStatus =
  | 'NEW'
  | 'AI_HANDLING'
  | 'WAITING_STAFF'
  | 'STAFF_HANDLING'
  | 'WAITING_USER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED';

export type TicketAction =
  | 'ACCEPT'
  | 'STAFF_REPLY'
  | 'USER_REPLY'
  | 'RESOLVE'
  | 'CLOSE'
  | 'REOPEN'
  | 'REASSIGN';

const transitions: Readonly<Record<TicketStatus, Partial<Record<TicketAction, TicketStatus>>>> = {
  NEW: {},
  AI_HANDLING: {},
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
  CANCELLED: {},
};

export function nextTicketStatus(
  status: TicketStatus,
  action: TicketAction,
): TicketStatus | null {
  return transitions[status]?.[action] ?? null;
}
