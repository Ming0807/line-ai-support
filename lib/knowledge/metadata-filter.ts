import type {KnowledgeMetadata, KnowledgeScope} from './types';

/** Dates are reviewed applicability metadata, never inferred from collection time. */
export function isValidKnowledgeDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function matchesScope(source: string | number | null, requested: string | number | null): boolean {
  return source === null || (requested !== null && source === requested);
}

/** Fail closed before ranking: semantic similarity cannot override eligibility. */
export function isKnowledgeEligible(
  source: KnowledgeMetadata,
  scope: KnowledgeScope,
  today: string,
): boolean {
  if (!isValidKnowledgeDate(today) || !source.approved || !source.officialSource ||
      !source.extractionReviewed || source.requiresReview || source.archiveOnly || source.visibility !== 'PUBLIC') return false;
  if (source.effectiveFrom === null || !isValidKnowledgeDate(source.effectiveFrom) ||
      (source.effectiveTo !== null && (!isValidKnowledgeDate(source.effectiveTo) || source.effectiveTo < source.effectiveFrom))) return false;

  if (scope.historical) {
    if (!['ACTIVE', 'SUPERSEDED', 'EXPIRED'].includes(source.status) ||
        (scope.academicYear === null && scope.asOfDate === null)) return false;
    if (scope.academicYear !== null && source.academicYear !== scope.academicYear) return false;
    if (scope.asOfDate !== null && (!isValidKnowledgeDate(scope.asOfDate) || scope.asOfDate < source.effectiveFrom ||
        (source.effectiveTo !== null && scope.asOfDate > source.effectiveTo))) return false;
  } else {
    if (source.status !== 'ACTIVE' || !source.isCurrent || scope.asOfDate !== null ||
        source.effectiveFrom > today || (source.effectiveTo !== null && source.effectiveTo < today) ||
        (scope.academicYear !== null && !matchesScope(source.academicYear, scope.academicYear))) return false;
  }

  if (scope.familyCodes.length > 0 && !scope.familyCodes.includes(source.familyCode)) return false;
  if (scope.departmentCode !== null && source.departmentCode !== null && source.departmentCode !== scope.departmentCode) return false;
  if (source.audience !== 'ALL' && (scope.audience === null || source.audience !== scope.audience)) return false;
  if (source.studentType !== 'ALL' && (scope.studentType === null || source.studentType !== scope.studentType)) return false;
  return matchesScope(source.semester, scope.semester) && matchesScope(source.programCode, scope.programCode) &&
    matchesScope(source.curriculumCode, scope.curriculumCode) && matchesScope(source.cohort, scope.cohort);
}
