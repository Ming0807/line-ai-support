import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import contextFixture from './fixtures/assistant-conversation-context.json';
import { validateAssistantConversationContext } from '../lib/ai/conversation-eval-context';

const frozenFixtureText = readFileSync(fileURLToPath(new URL('./fixtures/assistant-conversations.json', import.meta.url)), 'utf8');
const expectedScenarioIds = ['A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A18', 'B01'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function cloneFixture(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(contextFixture));
  return record(parsed, 'fixture');
}

function caseAt(fixture: Record<string, unknown>, scenarioId: string): Record<string, unknown> {
  const cases = array(fixture.cases, 'cases');
  const found = cases.find(item => isRecord(item) && item.scenarioId === scenarioId);
  return record(found, `${scenarioId} case`);
}

function sourceAt(fixture: Record<string, unknown>, sourceId: string): Record<string, unknown> {
  const sources = array(fixture.sources, 'sources');
  const found = sources.find(item => isRecord(item) && item.id === sourceId);
  return record(found, `${sourceId} source`);
}

describe('synthetic conversation context fixture', () => {
  it('validates bounded contexts for the requested frozen cases and real structured registry fields', () => {
    const result = validateAssistantConversationContext(contextFixture, frozenFixtureText);

    expect(result.cases.map(item => item.scenarioId)).toEqual(expectedScenarioIds);
    expect(result.sources.map(item => item.id)).toHaveLength(13);
    expect(result.syntheticAuthority).toBe('NOT_REAL_YRU_POLICY');
    expect(result.cases.find(item => item.scenarioId === 'A14')?.priorUserMessages).toHaveLength(1);
    expect(result.cases.find(item => item.scenarioId === 'A11')?.priorUserMessages).toHaveLength(1);
    expect(result.cases.find(item => item.scenarioId === 'A15')?.priorUserMessages).toHaveLength(1);
    expect(result.cases.find(item => item.scenarioId === 'A16')?.priorUserMessages).toHaveLength(1);
    const feeSource = result.sources.find(item => item.id === 'a11-fee-2569-normal');
    const termSource = result.sources.find(item => item.id === 'a12-term-open');
    const librarySource = result.sources.find(item => item.id === 'a13-regular-hours');
    expect(feeSource?.kind).toBe('STRUCTURED');
    expect(termSource?.kind).toBe('STRUCTURED');
    expect(librarySource?.kind).toBe('STRUCTURED');
    if (feeSource?.kind !== 'STRUCTURED' || termSource?.kind !== 'STRUCTURED' || librarySource?.kind !== 'STRUCTURED') {
      throw new Error('Expected structured fixture sources');
    }
    expect(feeSource.dataset).toBe('tuition_fees');
    expect(termSource.dataset).toBe('academic_calendar_events');
    expect(librarySource.dataset).toBe('university_services');
  });

  it('rejects any changed bytes in the frozen prompt fixture', () => {
    expect(() => validateAssistantConversationContext(contextFixture, `${frozenFixtureText}\n`)).toThrow(
      'FROZEN_FIXTURE_HASH_MISMATCH',
    );
  });

  it('rejects unknown and duplicate scenario IDs', () => {
    const unknown = cloneFixture();
    caseAt(unknown, 'A10').scenarioId = 'A99';
    expect(() => validateAssistantConversationContext(unknown, frozenFixtureText)).toThrow('UNKNOWN_SCENARIO_ID');

    const duplicate = cloneFixture();
    const cases = array(duplicate.cases, 'cases');
    cases.push({ ...caseAt(duplicate, 'A10') });
    expect(() => validateAssistantConversationContext(duplicate, frozenFixtureText)).toThrow('DUPLICATE_SCENARIO_ID');
  });

  it('rejects dangling, orphaned, or cross-scenario source references', () => {
    const dangling = cloneFixture();
    caseAt(dangling, 'A10').sourceIds = ['missing-source'];
    expect(() => validateAssistantConversationContext(dangling, frozenFixtureText)).toThrow('SOURCE_REFERENCE_INVALID');

    const crossScenario = cloneFixture();
    sourceAt(crossScenario, 'a10-form').scenarioId = 'A11';
    expect(() => validateAssistantConversationContext(crossScenario, frozenFixtureText)).toThrow('SOURCE_CONTEXT_MISMATCH');

    const orphaned = cloneFixture();
    const sources = array(orphaned.sources, 'sources');
    sources.push({ ...sourceAt(orphaned, 'a10-form'), id: 'unused-a10-source' });
    expect(() => validateAssistantConversationContext(orphaned, frozenFixtureText)).toThrow('ORPHAN_SOURCE');
  });

  it('rejects URLs outside the fixture host and private credentials or identifiers', () => {
    const externalUrl = cloneFixture();
    sourceAt(externalUrl, 'a10-form').url = 'https://yru.ac.th/forms/a10';
    expect(() => validateAssistantConversationContext(externalUrl, frozenFixtureText)).toThrow('URL_OUTSIDE_FIXTURE_HOST');

    const privateField = cloneFixture();
    caseAt(privateField, 'A10').lineUserId = 'U1234567890';
    expect(() => validateAssistantConversationContext(privateField, frozenFixtureText)).toThrow('PRIVATE_FIELD_FORBIDDEN');

    const privateValue = cloneFixture();
    caseAt(privateValue, 'A10').priorUserMessages = ['รหัสผ่าน: super-secret-password'];
    expect(() => validateAssistantConversationContext(privateValue, frozenFixtureText)).toThrow('PRIVATE_VALUE_FORBIDDEN');
  });

  it('rejects dataset payloads that do not match the installed structured schema', () => {
    const invalidPayload = cloneFixture();
    sourceAt(invalidPayload, 'a11-fee-2569-normal').payload = {
      academic_year: 2569,
      program_name: 'หลักสูตรทดสอบ',
      fee_amount: '12345.00',
    };
    expect(() => validateAssistantConversationContext(invalidPayload, frozenFixtureText)).toThrow('STRUCTURED_PAYLOAD_INVALID');
  });

  it('rejects case evidence that fails its scenario-specific year, audience, qualifier, or prior-user relationship', () => {
    const wrongYear = cloneFixture();
    sourceAt(wrongYear, 'a11-fee-2569-normal').payload = {
      ...record(sourceAt(wrongYear, 'a11-fee-2569-normal').payload, 'fee payload'),
      academic_year: 2568,
    };
    expect(() => validateAssistantConversationContext(wrongYear, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const missingDeicticSource = cloneFixture();
    caseAt(missingDeicticSource, 'A14').priorUserMessages = [];
    expect(() => validateAssistantConversationContext(missingDeicticSource, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');
  });

  it('requires A11, A15, and A16 to carry their explicitly sourced prior USER context', () => {
    for (const scenarioId of ['A11', 'A15', 'A16']) {
      const missingContext = cloneFixture();
      caseAt(missingContext, scenarioId).priorUserMessages = [];
      expect(() => validateAssistantConversationContext(missingContext, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');
    }
  });

  it('rejects fee audience, calendar event-date, and service-hour scope substitutions', () => {
    const wrongAudience = cloneFixture();
    const fee = sourceAt(wrongAudience, 'a11-fee-2569-normal');
    const feePayload = record(fee.payload, 'fee payload');
    fee.payload = { ...feePayload, student_group: 'บัณฑิตศึกษาทดสอบ' };
    expect(() => validateAssistantConversationContext(wrongAudience, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const wrongDate = cloneFixture();
    const opening = sourceAt(wrongDate, 'a12-term-open');
    const openingPayload = record(opening.payload, 'opening payload');
    opening.payload = { ...openingPayload, start_date: '2026-05-20' };
    expect(() => validateAssistantConversationContext(wrongDate, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const wrongHours = cloneFixture();
    const regular = sourceAt(wrongHours, 'a13-regular-hours');
    const regularPayload = record(regular.payload, 'hours payload');
    regular.payload = { ...regularPayload, opening_hours: 'ทุกวัน 10:00-12:00' };
    expect(() => validateAssistantConversationContext(wrongHours, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');
  });

  it('keeps requested A11 and A12 selector values literal rather than synthetic suffixes', () => {
    const result = validateAssistantConversationContext(contextFixture, frozenFixtureText);
    const fee = result.sources.find(source => source.id === 'a11-fee-2569-normal');
    expect(fee?.kind === 'STRUCTURED' && isRecord(fee.payload) ? fee.payload.student_group : null).toBe('ปริญญาตรี');
    expect(fee?.kind === 'STRUCTURED' && isRecord(fee.payload) ? fee.payload.study_type : null).toBe('ภาคปกติ');

    const opening = result.sources.find(source => source.id === 'a12-term-open');
    expect(opening?.kind === 'STRUCTURED' && isRecord(opening.payload) ? opening.payload.event_type : null).toBe('OPENING');
    expect(opening?.kind === 'STRUCTURED' && isRecord(opening.payload) ? opening.payload.title : null).toBe('วันเปิดภาคเรียน');

    const registration = result.sources.find(source => source.id === 'a12-registration-window');
    expect(registration?.kind === 'STRUCTURED' && isRecord(registration.payload) ? registration.payload.event_type : null).toBe('REGISTRATION');

    const wrongServiceName = cloneFixture();
    const service = sourceAt(wrongServiceName, 'a13-regular-hours');
    const servicePayload = record(service.payload, 'service payload');
    service.payload = { ...servicePayload, name: 'ห้องสมุดสังเคราะห์' };
    expect(() => validateAssistantConversationContext(wrongServiceName, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const changedFeeScope = cloneFixture();
    const changedFee = sourceAt(changedFeeScope, 'a11-fee-2569-normal');
    const changedFeePayload = record(changedFee.payload, 'fee payload');
    changedFee.payload = { ...changedFeePayload, student_group: 'ปริญญาตรีทดสอบ' };
    expect(() => validateAssistantConversationContext(changedFeeScope, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const changedProgram = cloneFixture();
    const namedProgram = sourceAt(changedProgram, 'a11-fee-2569-normal');
    const namedProgramPayload = record(namedProgram.payload, 'fee payload');
    namedProgram.payload = { ...namedProgramPayload, program_name: 'หลักสูตรอื่นทดสอบ' };
    expect(() => validateAssistantConversationContext(changedProgram, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');

    const changedEvent = cloneFixture();
    const changedOpening = sourceAt(changedEvent, 'a12-term-open');
    const changedOpeningPayload = record(changedOpening.payload, 'opening payload');
    changedOpening.payload = { ...changedOpeningPayload, event_type: 'TERM_OPEN_TEST_ONLY' };
    expect(() => validateAssistantConversationContext(changedEvent, frozenFixtureText)).toThrow('SCENARIO_CONTEXT_MISMATCH');
  });
});
