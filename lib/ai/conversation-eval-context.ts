import { createHash } from 'node:crypto';
import { z } from 'zod';
import { STRUCTURED_DATASETS, validateStructuredPayload } from '../knowledge/structured-payload';

const FROZEN_FIXTURE_SHA256 = 'E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3';
const REQUIRED_SCENARIOS = ['A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A18', 'B01'] as const;
const SYNTHETIC_AUTHORITY = 'NOT_REAL_YRU_POLICY';

const contextCaseSchema = z.object({
  scenarioId: z.string().min(1),
  priorUserMessages: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)),
  purpose: z.string().min(1),
}).strict();

const sourceBase = {
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  syntheticAuthority: z.literal(SYNTHETIC_AUTHORITY),
  url: z.string().url(),
};

const structuredSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('STRUCTURED'),
  dataset: z.enum(STRUCTURED_DATASETS),
  payload: z.unknown(),
}).strict();

const ragHtmlSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('RAG_HTML'),
  html: z.string().min(1),
}).strict();

const contextFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  syntheticAuthority: z.literal(SYNTHETIC_AUTHORITY),
  frozenFixtureSha256: z.string().regex(/^[A-F0-9]{64}$/u),
  cases: z.array(contextCaseSchema).min(1),
  sources: z.array(z.discriminatedUnion('kind', [structuredSourceSchema, ragHtmlSourceSchema])).min(1),
}).strict();

export type AssistantConversationContextFixture = z.infer<typeof contextFixtureSchema>;
export type AssistantConversationContextCase = z.infer<typeof contextCaseSchema>;
export type AssistantConversationContextSource = z.infer<typeof contextFixtureSchema>['sources'][number];

export class AssistantConversationContextError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AssistantConversationContextError';
  }
}

function fail(code: string): never {
  throw new AssistantConversationContextError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateFrozenFixtureBytes(frozenFixtureText: string): void {
  const digest = createHash('sha256').update(frozenFixtureText, 'utf8').digest('hex').toUpperCase();
  if (digest !== FROZEN_FIXTURE_SHA256) fail('FROZEN_FIXTURE_HASH_MISMATCH');

  let parsed: unknown;
  try {
    parsed = JSON.parse(frozenFixtureText);
  } catch {
    fail('FROZEN_FIXTURE_INVALID');
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.scenarios)) {
    fail('FROZEN_FIXTURE_INVALID');
  }

  const ids = parsed.scenarios.map((scenario: unknown) =>
    isRecord(scenario) && typeof scenario.id === 'string' ? scenario.id : null,
  );
  if (ids.length !== 30 || ids.some(id => id === null) || new Set(ids).size !== 30) {
    fail('FROZEN_FIXTURE_INVALID');
  }
  const frozenIds = new Set(ids);
  if (REQUIRED_SCENARIOS.some(id => !frozenIds.has(id))) fail('FROZEN_FIXTURE_INVALID');
}

function validateSafeString(value: string): void {
  const urlMatches = value.match(/https?:\/\/[^\s"'<>]+/giu) ?? [];
  for (const candidate of urlMatches) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      fail('URL_OUTSIDE_FIXTURE_HOST');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'fixture.yru.ac.th'
      || url.username || url.password || url.port || url.search || url.hash
      || !url.pathname.startsWith('/synthetic/')) {
      fail('URL_OUTSIDE_FIXTURE_HOST');
    }
  }

  if (/(?:รหัสผ่าน|password)\s*[:=]|\bBearer\s+[A-Za-z0-9._~-]+|\bsk-[A-Za-z0-9_-]{10,}|\bU[0-9A-F]{16,}\b/iu.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    fail('PRIVATE_VALUE_FORBIDDEN');
  }
}

function scanForPrivateData(value: unknown): void {
  if (typeof value === 'string') {
    validateSafeString(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(scanForPrivateData);
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (/(?:line.?user.?id|user.?id|student.?id|password|credential|access.?token|refresh.?token|reply.?token|api.?key|secret)/iu.test(key)) {
      fail('PRIVATE_FIELD_FORBIDDEN');
    }
    if ((key === 'email' || key === 'phone') && child !== null && child !== '') fail('PRIVATE_VALUE_FORBIDDEN');
    scanForPrivateData(child);
  }
}

function validateSource(source: AssistantConversationContextSource): void {
  validateSafeString(source.url);
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.hostname !== 'fixture.yru.ac.th'
    || url.username || url.password || url.port || url.search || url.hash
    || !url.pathname.startsWith('/synthetic/')) {
    fail('URL_OUTSIDE_FIXTURE_HOST');
  }

  if (source.kind === 'STRUCTURED') {
    try {
      validateStructuredPayload(source.dataset, source.payload);
    } catch {
      fail('STRUCTURED_PAYLOAD_INVALID');
    }
    const payload = source.payload;
    if (!isRecord(payload)) fail('STRUCTURED_PAYLOAD_INVALID');
    const visibleText = Object.values(payload).filter((item): item is string => typeof item === 'string').join(' ');
    if (!/(?:ทดสอบ|สังเคราะห์|TEST_ONLY)/iu.test(visibleText)) fail('SYNTHETIC_LABEL_REQUIRED');
  } else if (!source.html.includes(SYNTHETIC_AUTHORITY)) {
    fail('SYNTHETIC_LABEL_REQUIRED');
  }
}

function getScenarioSources(
  scenario: AssistantConversationContextCase,
  sourcesById: ReadonlyMap<string, AssistantConversationContextSource>,
): AssistantConversationContextSource[] {
  return scenario.sourceIds.map(id => {
    const source = sourcesById.get(id);
    if (!source) fail('SOURCE_REFERENCE_INVALID');
    if (source.scenarioId !== scenario.scenarioId) fail('SOURCE_CONTEXT_MISMATCH');
    return source;
  });
}

function requireScenarioContext(
  scenario: AssistantConversationContextCase,
  sources: readonly AssistantConversationContextSource[],
): void {
  const structured = sources.filter(source => source.kind === 'STRUCTURED');
  const rag = sources.filter(source => source.kind === 'RAG_HTML');
  const payloads = structured.map(source => ({ dataset: source.dataset, payload: source.payload }));

  switch (scenario.scenarioId) {
    case 'A10':
      if (!payloads.some(item => item.dataset === 'service_forms')) fail('SCENARIO_CONTEXT_MISMATCH');
      break;
    case 'A11': {
      const fees = payloads.filter((item): item is { dataset: 'tuition_fees'; payload: unknown } => item.dataset === 'tuition_fees')
        .map(item => item.payload).filter(isRecord);
      const requestedFee = fees.find(row => row.academic_year === 2569 && row.student_group === 'ปริญญาตรี'
        && row.study_type === 'ภาคปกติ');
      if (scenario.priorUserMessages.length !== 1 || !requestedFee
        || typeof requestedFee.program_name !== 'string'
        || !scenario.priorUserMessages[0]!.includes(requestedFee.program_name)
        || !fees.some(row => row.academic_year !== 2569 || row.student_group !== 'ปริญญาตรี'
          || row.study_type !== 'ภาคปกติ')) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    }
    case 'A12': {
      const events = payloads.filter((item): item is { dataset: 'academic_calendar_events'; payload: unknown } => item.dataset === 'academic_calendar_events')
        .map(item => item.payload).filter(isRecord);
      const opening = events.find(row => row.academic_year === 2569 && row.event_type === 'OPENING'
        && typeof row.title === 'string' && row.title.includes('วันเปิดภาคเรียน'));
      const registration = events.find(row => row.event_type === 'REGISTRATION'
        && typeof row.title === 'string' && row.title.includes('ช่วงลงทะเบียน'));
      if (!opening || !registration || opening.start_date === registration.start_date) fail('SCENARIO_CONTEXT_MISMATCH');
      break;
    }
    case 'A13': {
      const services = payloads.filter((item): item is { dataset: 'university_services'; payload: unknown } => item.dataset === 'university_services')
        .map(item => item.payload).filter(isRecord);
      if (!services.some(row => row.name === 'ห้องสมุด' && typeof row.opening_hours === 'string'
          && /วันเสาร์/u.test(row.opening_hours) && /ไม่รวมวันหยุด/u.test(row.opening_hours))
        || !services.some(row => row.name === 'ห้องสมุด' && typeof row.opening_hours === 'string'
          && /วันหยุด/u.test(row.opening_hours) && !/วันเสาร์/u.test(row.opening_hours))) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    }
    case 'A14':
      if (scenario.priorUserMessages.length !== 1 || rag.length !== 1
        || !scenario.priorUserMessages[0]!.includes('กลุ่มทดลอง X')
        || !rag[0]!.html.includes('กลุ่มทดลอง X') || !rag[0]!.html.includes('ไม่ได้ให้นิยาม')) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    case 'A15':
      if (scenario.priorUserMessages.length !== 1 || rag.length !== 1
        || !scenario.priorUserMessages[0]!.includes('คู่มือระบบทดสอบสังเคราะห์ A15')
        || !rag[0]!.html.includes('<h1>คู่มือระบบทดสอบสังเคราะห์ A15</h1>')
        || !rag[0]!.html.includes('คำเตือน') || !rag[0]!.html.includes('ก่อนเริ่ม')) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    case 'A16':
      if (scenario.priorUserMessages.length !== 1 || !payloads.some(item => item.dataset === 'service_forms' && isRecord(item.payload)
        && typeof item.payload.name === 'string' && typeof item.payload.description === 'string'
        && scenario.priorUserMessages[0]!.includes(item.payload.name)
        && item.payload.description.includes('ใช้แจ้งแก้ไขข้อมูลติดต่อ'))) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    case 'A18':
      if (scenario.priorUserMessages.length !== 1 || !scenario.priorUserMessages[0]!.includes('ลงทะเบียน')
        || !payloads.some(item => item.dataset === 'academic_calendar_events' && isRecord(item.payload)
          && item.payload.academic_year === 2569 && item.payload.event_type === 'REGISTRATION'
          && typeof item.payload.title === 'string' && item.payload.title.includes('เริ่มลงทะเบียน'))) {
        fail('SCENARIO_CONTEXT_MISMATCH');
      }
      break;
    case 'B01': {
      const fees = payloads.filter((item): item is { dataset: 'tuition_fees'; payload: unknown } => item.dataset === 'tuition_fees')
        .map(item => item.payload).filter(isRecord);
      if (fees.length < 2 || new Set(fees.map(row => row.academic_year)).size < 1
        || new Set(fees.map(row => row.program_name)).size < 2
        || new Set(fees.map(row => row.student_group)).size < 2
        || new Set(fees.map(row => row.study_type)).size < 2) fail('SCENARIO_CONTEXT_MISMATCH');
      break;
    }
    default:
      fail('UNKNOWN_SCENARIO_ID');
  }
}

/** Validates synthetic context against the exact frozen prompt bytes and installed data schemas. */
export function validateAssistantConversationContext(
  input: unknown,
  frozenFixtureText: string,
): AssistantConversationContextFixture {
  validateFrozenFixtureBytes(frozenFixtureText);
  scanForPrivateData(input);
  const parsed = contextFixtureSchema.safeParse(input);
  if (!parsed.success) fail('CONTEXT_FIXTURE_INVALID');
  const fixture = parsed.data;
  if (fixture.frozenFixtureSha256 !== FROZEN_FIXTURE_SHA256) fail('FROZEN_FIXTURE_HASH_MISMATCH');

  const ids = fixture.cases.map(item => item.scenarioId);
  const requiredScenarioIds = new Set<string>(REQUIRED_SCENARIOS);
  if (ids.some(id => !requiredScenarioIds.has(id))) fail('UNKNOWN_SCENARIO_ID');
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_SCENARIO_ID');
  if (REQUIRED_SCENARIOS.some(id => !ids.includes(id))) fail('MISSING_SCENARIO_ID');

  const sourcesById = new Map<string, AssistantConversationContextSource>();
  for (const source of fixture.sources) {
    if (sourcesById.has(source.id)) fail('DUPLICATE_SOURCE_ID');
    sourcesById.set(source.id, source);
    validateSource(source);
  }

  const referenced = new Set<string>();
  for (const scenario of fixture.cases) {
    if (new Set(scenario.sourceIds).size !== scenario.sourceIds.length) fail('DUPLICATE_SOURCE_REFERENCE');
    const sources = getScenarioSources(scenario, sourcesById);
    sources.forEach(source => referenced.add(source.id));
    requireScenarioContext(scenario, sources);
  }
  if ([...sourcesById.keys()].some(id => !referenced.has(id))) fail('ORPHAN_SOURCE');

  return fixture;
}
