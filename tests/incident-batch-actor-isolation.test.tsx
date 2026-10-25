import { Children, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import IncidentDetailView from '@/app/(dashboard)/incidents/IncidentDetailView';
import IncidentBatchReply from '@/app/(dashboard)/incidents/IncidentBatchReply';

const detail = {
  incident: {
    id: 'f3cbab47-439d-46e3-9559-9238737bba29', revision: 4,
    title: 'ระบบลงทะเบียนตอบสนองช้า', category: 'REGISTRATION', departmentLabel: 'งานทะเบียน',
    status: 'INVESTIGATING' as const, severity: 'HIGH' as const, sensitivity: 'SENSITIVE' as const,
    reportCount: 6, distinctSessionCount: 5,
    createdAt: '2026-10-08T01:00:00.000Z', updatedAt: '2026-10-08T02:00:00.000Z',
  },
  canManage: true,
  tickets: [],
};

const actorA = 'cf4a12a0-2d9d-4a82-9d02-41384dc46c57';
const actorB = '7ebfb3aa-9a28-4dcf-b0a2-94fb3bfc583e';

function batchReplyKey(actorId: string): string | null {
  const view = IncidentDetailView({ detail, actorId });
  const child = Children.toArray(view.props.children)
    .find(element => isValidElement(element) && element.type === IncidentBatchReply);
  return isValidElement(child) ? child.key : null;
}

describe('incident batch actor isolation', () => {
  it('uses a stable mount key per actor for the same incident', () => {
    expect(batchReplyKey(actorA)).not.toBeNull();
    expect(batchReplyKey(actorA)).toBe(batchReplyKey(actorA));
    expect(batchReplyKey(actorA)).not.toBe(batchReplyKey(actorB));
  });
});
