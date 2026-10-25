import { z } from 'zod';
import { lineMessages } from '../knowledge/citations';
import { IncidentError } from './contracts';
import { incidentReplyPacketSchema, incidentReplySelectionSchema, type IncidentReplyPacket } from './batch-reply-contracts';

export interface IncidentPacketMember {
  ticketId: string;
  ticketCode: string;
  reporterLabel: string;
  sessionId: string;
}

const invalid = (): never => { throw new IncidentError('INVALID_REQUEST'); };
const uuid = z.uuid().transform(value => value.toLowerCase());
const packetMemberSchema = z.strictObject({
  ticketId: uuid,
  ticketCode: z.string().min(1).max(100).refine(value => value.trim().length > 0),
  reporterLabel: z.string().min(1).max(200).refine(value => value.trim().length > 0),
  sessionId: uuid,
});
const packetMembersSchema = z.array(packetMemberSchema).min(1).max(100).refine(members =>
  new Set(members.map(member => member.ticketId)).size === members.length,
);

function compareTicketId(a: IncidentPacketMember, b: IncidentPacketMember): number {
  return a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0;
}

export function prepareIncidentReplyPackets(members: readonly IncidentPacketMember[], commonText: string): IncidentReplyPacket[] {
  const parsedMembers = packetMembersSchema.safeParse(members);
  const parsedText = incidentReplySelectionSchema.shape.text.safeParse(commonText);
  if (!parsedMembers.success || !parsedText.success) return invalid();

  const groups = new Map<string, IncidentPacketMember[]>();
  for (const member of parsedMembers.data) {
    const group = groups.get(member.sessionId) ?? [];
    group.push(member);
    groups.set(member.sessionId, group);
  }

  const orderedGroups = [...groups.values()].map(group => group.sort(compareTicketId))
    .sort((a, b) => compareTicketId(a[0], b[0]));

  return orderedGroups.map((group, index) => {
    const cases = group.map(({ ticketId, ticketCode, reporterLabel }) => ({ ticketId, ticketCode, reporterLabel }));
    const studentText = `อัปเดตเคส: ${cases.map(item => item.ticketCode).join(', ')}\n\n${parsedText.data}`;
    let messages: ReturnType<typeof lineMessages>;
    try {
      messages = lineMessages(studentText);
    } catch {
      return invalid();
    }
    const packet = incidentReplyPacketSchema.safeParse({ recipientCode: `R${index + 1}`, cases, messages });
    if (!packet.success) return invalid();
    return packet.data;
  });
}
