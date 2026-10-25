import type { AssistantConversationContextSource } from '../../lib/ai/conversation-eval-context';
import { createHash } from 'node:crypto';
import { getStructuredRegistryEntry } from '../../lib/knowledge/structured-registry';
import { validateStructuredPayload } from '../../lib/knowledge/structured-payload';
import { createImportSource } from '../../lib/imports/source';
import type { ImportSource } from '../../lib/imports/types';

const ownedCaseDatasets: Readonly<Record<string, string>> = Object.freeze({
  A10: 'service_forms',
  A11: 'tuition_fees',
  A12: 'academic_calendar_events',
  A13: 'university_services',
  A16: 'service_forms',
  A18: 'academic_calendar_events',
  B01: 'tuition_fees',
});
const ownedRagSources: Readonly<Record<string, { id: string; sha256: string }>> = Object.freeze({
  A14: { id: 'a14-announcement', sha256: '65F8A6059C41EB00B7D8ECB5174B0D42F92E9D728C43B77C8B31AABEA54201BB' },
  A15: { id: 'a15-system-guide', sha256: '703C3A09C72DDF24F952419266021B7E5029E547892E0AC5865199876B121C8D' },
});

function quoteCsv(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Convert one exact synthetic companion record into its exact upload bytes. */
export function createOwnedAssistantSource(item: AssistantConversationContextSource): ImportSource {
  if (item.syntheticAuthority !== 'NOT_REAL_YRU_POLICY' || !/^[a-z0-9-]{1,120}$/u.test(item.id)) {
    throw new Error('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
  }

  if (item.kind === 'RAG_HTML') {
    const expected = ownedRagSources[item.scenarioId];
    const digest = createHash('sha256').update(item.html, 'utf8').digest('hex').toUpperCase();
    if (!expected || expected.id !== item.id || expected.sha256 !== digest
      || item.url !== `https://fixture.yru.ac.th/synthetic/${item.id}.html`
      || !item.html.includes('NOT_REAL_YRU_POLICY')) {
      throw new Error('ASSISTANT_OWNED_RAG_SOURCE_INVALID');
    }
    const html = `<!doctype html><html><body>${item.html}</body></html>`;
    return createImportSource({
      bytes: new TextEncoder().encode(html),
      filename: `${item.id}.html`,
      mimeType: 'text/html',
      sourceUrl: item.url,
      acquiredFrom: 'UPLOAD',
      fetchedAt: null,
    });
  }

  if (ownedCaseDatasets[item.scenarioId] !== item.dataset) {
    throw new Error('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
  }

  try {
    const entry = getStructuredRegistryEntry(item.dataset);
    const payload = validateStructuredPayload(item.dataset, item.payload) as Record<string, string | number | null>;
    const headers = entry.fields.map(field => field.name);
    const row = headers.map(header => {
      const value = payload[header];
      if (value === null) return '';
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
      }
      return String(value);
    });
    const csv = [headers.map(quoteCsv).join(','), row.map(quoteCsv).join(',')].join('\r\n');
    return createImportSource({
      bytes: new TextEncoder().encode(csv),
      filename: `${item.id}.csv`,
      mimeType: 'text/csv',
      sourceUrl: item.url,
      acquiredFrom: 'UPLOAD',
      fetchedAt: null,
    });
  } catch {
    throw new Error('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
  }
}
