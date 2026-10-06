import { expect, it } from 'vitest';
import type { InitialDocumentFamily } from '../lib/imports/family-catalog';

const expectedCodes = [
  'ACADEMIC_CALENDAR',
  'REGISTRATION_GUIDE',
  'TRANSFER_REGULATION',
  'TRANSFER_GUIDE',
  'TRANSFER_COURSE_TABLE',
  'TUITION_FEE',
  'EXAM_REGULATION',
  'GRADING_REGULATION',
  'TRANSCRIPT_GUIDE',
  'CERTIFICATE_GUIDE',
  'COURSE_WITHDRAWAL_GUIDE',
  'SPECIAL_COURSE_GUIDE',
  'WIFI_GUIDE',
  'YRU_PASSPORT_GUIDE',
  'MICROSOFT_365_GUIDE',
  'LIBRARY_GUIDE',
  'STUDENT_ACTIVITY_RULE',
  'VOLUNTEER_ACTIVITY_RULE',
  'DORMITORY_RULE',
];

async function loadCatalog() {
  const catalog = await import('../lib/imports/family-catalog').catch(() => null);
  expect(catalog).not.toBeNull();
  return catalog;
}

it('provides exactly the documented initial family codes without duplicates', async () => {
  const catalog = await loadCatalog();
  if (!catalog) return;

  const families = catalog.getInitialDocumentFamilies();
  expect(families).toHaveLength(19);
  expect(families.map(({ code }) => code)).toEqual(expectedCodes);
  expect(new Set(families.map(({ code }) => code)).size).toBe(19);
});

it('returns valid bounded catalog data with clear names and categories', async () => {
  const catalog = await loadCatalog();
  if (!catalog) return;

  for (const family of catalog.getInitialDocumentFamilies()) {
    expect(family.code).toMatch(/^[A-Z][A-Z0-9_]{0,79}$/);
    expect(family.name.trim().length).toBeGreaterThan(0);
    expect(family.name.length).toBeLessThanOrEqual(200);
    expect(family.category.trim().length).toBeGreaterThan(0);
    expect(family.category.length).toBeLessThanOrEqual(80);
  }
});

it('returns fresh records so caller mutation cannot alter later catalog results', async () => {
  const catalog = await loadCatalog();
  if (!catalog) return;

  const first = catalog.getInitialDocumentFamilies();
  first[0]!.name = 'mutated';
  first.pop();

  const second = catalog.getInitialDocumentFamilies();
  expect(second).toHaveLength(19);
  expect(second[0]?.name).not.toBe('mutated');
});

it('keeps the public family shape open to explicitly reviewed custom families', async () => {
  const catalog = await loadCatalog();
  if (!catalog) return;

  const custom: InitialDocumentFamily = {
      code: 'REVIEWED_CUSTOM_FAMILY',
      name: 'เอกสารที่ผ่านการพิจารณาเพิ่มเติม',
      category: 'เอกสารอื่น',
    };

  expect(custom.code).not.toBe('');
  expect(catalog.getInitialDocumentFamilies().some(({ code }) => code === custom.code)).toBe(false);
});
