import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import contextFixture from './fixtures/assistant-conversation-context.json';
import { validateAssistantConversationContext } from '../lib/ai/conversation-eval-context';
import { getStructuredRegistryEntry } from '../lib/knowledge/structured-registry';
import { parseCsvSource } from '../lib/imports/csv-parser';
import { createOwnedAssistantSource } from '../scripts/qa/assistant-owned-source';

const frozenFixtureText = readFileSync(fileURLToPath(new URL('./fixtures/assistant-conversations.json', import.meta.url)), 'utf8');
const validated = validateAssistantConversationContext(contextFixture, frozenFixtureText);

function structuredSource(id: string) {
  const source = validated.sources.find(item => item.id === id);
  if (!source || source.kind !== 'STRUCTURED') throw new Error(`Expected structured source ${id}`);
  return source;
}

describe('assistant-owned synthetic structured source', () => {
  it('prepares the exact A10 form payload as a stable uploaded CSV source', () => {
    const result = createOwnedAssistantSource(structuredSource('a10-form'));

    expect(result.filename).toBe('a10-form.csv');
    expect(result.format).toBe('CSV');
    expect(result.mimeType).toBe('text/csv');
    expect(result.sourceUrl).toBe('https://fixture.yru.ac.th/synthetic/a10-form');
    expect(result.acquiredFrom).toBe('UPLOAD');
    expect(result.fetchedAt).toBeNull();
    expect(new TextDecoder().decode(result.bytes)).toBe([
      'name,description,form_url,requirements',
      'แบบคำร้องทดสอบ A10,แบบฟอร์มสังเคราะห์เพื่อทดสอบตำแหน่งแบบคำร้องเท่านั้น,https://fixture.yru.ac.th/synthetic/forms/a10,ข้อมูลตัวอย่าง ไม่ใช่ข้อกำหนดจริง',
    ].join('\r\n'));
  });

  it('retains exact A11 selector values and the decimal text for both disambiguating rows', () => {
    const result = createOwnedAssistantSource(structuredSource('a11-fee-2569-normal'));

    expect(new TextDecoder().decode(result.bytes)).toBe([
      'academic_year,program_name,major_name,student_group,study_type,fee_amount,currency,effective_from,effective_to',
      '2569,หลักสูตรทดสอบสังเคราะห์ A11,,ปริญญาตรี,ภาคปกติ,12345.00,THB,2026-01-01,2026-12-31',
    ].join('\r\n'));
    const other = createOwnedAssistantSource(structuredSource('a11-fee-2568-other-group'));
    expect(new TextDecoder().decode(other.bytes).split('\r\n')[1]).toContain('2568,หลักสูตรบัณฑิตศึกษาทดสอบ A11,,บัณฑิตศึกษา,ภาคพิเศษ,98765.00');
  });

  it('round-trips every approved structured fixture through its registered CSV columns', () => {
    const allowed = new Map<string, string>([
      ['A10', 'service_forms'],
      ['A11', 'tuition_fees'],
      ['A12', 'academic_calendar_events'],
      ['A13', 'university_services'],
      ['A16', 'service_forms'],
      ['A18', 'academic_calendar_events'],
      ['B01', 'tuition_fees'],
    ]);
    const sources = validated.sources.filter(item => item.kind === 'STRUCTURED');

    expect(new Set(sources.map(item => item.scenarioId))).toEqual(new Set(allowed.keys()));
    for (const item of sources) {
      expect(item.dataset).toBe(allowed.get(item.scenarioId));
      const uploaded = createOwnedAssistantSource(item);
      const parsed = parseCsvSource(uploaded);
      const entry = getStructuredRegistryEntry(item.dataset);
      const expected = entry.fields.map(field => {
        const value = (item.payload as Record<string, string | number | null>)[field.name];
        return value === null ? '' : String(value);
      });

      expect(parsed.tables).toHaveLength(1);
      expect(parsed.tables[0]?.rows).toEqual([entry.fields.map(field => field.name), expected]);
    }
  });

  it('CSV-quotes commas, quotes, and newlines without changing the cell value', () => {
    const source = structuredSource('a10-form');
    const changed = { ...source, payload: { ...(source.payload as Record<string, unknown>), description: 'part one, "quoted"\nand two' } };
    const result = createOwnedAssistantSource(changed);

    expect(new TextDecoder().decode(result.bytes).split('\r\n')[1]).toBe(
      'แบบคำร้องทดสอบ A10,"part one, ""quoted""\nand two",https://fixture.yru.ac.th/synthetic/forms/a10,ข้อมูลตัวอย่าง ไม่ใช่ข้อกำหนดจริง',
    );
  });

  it('prepares only the exact reviewed A14/A15 RAG_HTML fixtures as local HTML uploads', () => {
    for (const id of ['a14-announcement', 'a15-system-guide']) {
      const source = validated.sources.find(item => item.id === id);
      if (!source || source.kind !== 'RAG_HTML') throw new Error(`Expected RAG_HTML source ${id}`);
      const uploaded = createOwnedAssistantSource(source);

      expect(uploaded.filename).toBe(`${id}.html`);
      expect(uploaded.format).toBe('HTML');
      expect(uploaded.mimeType).toBe('text/html');
      expect(uploaded.sourceUrl).toBe(source.url);
      expect(new TextDecoder().decode(uploaded.bytes)).toBe(`<!doctype html><html><body>${source.html}</body></html>`);
      expect(source.html).toContain('NOT_REAL_YRU_POLICY');
      expect(() => createOwnedAssistantSource({ ...source, html: `${source.html} changed` }))
        .toThrow('ASSISTANT_OWNED_RAG_SOURCE_INVALID');
    }
  });

  it('rejects RAG sources, unapproved structured datasets, and invalid registry payloads', () => {
    const rag = validated.sources.find(item => item.id === 'a14-announcement');
    expect(() => createOwnedAssistantSource(rag!)).not.toThrow();
    expect(() => createOwnedAssistantSource({
      ...structuredSource('a10-form'), dataset: 'university_services',
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
    expect(() => createOwnedAssistantSource({
      ...structuredSource('a10-form'), payload: { name: 'bad' },
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
    expect(() => createOwnedAssistantSource({
      ...structuredSource('a10-form'), scenarioId: 'A12',
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
    expect(() => createOwnedAssistantSource({
      ...structuredSource('a12-term-open'), scenarioId: 'A13',
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
    expect(() => createOwnedAssistantSource({
      ...structuredSource('a12-term-open'), dataset: 'university_services',
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
    expect(() => createOwnedAssistantSource({
      ...structuredSource('b01-fee-undergraduate'), scenarioId: 'B02',
    })).toThrow('ASSISTANT_OWNED_STRUCTURED_SOURCE_INVALID');
  });
});
