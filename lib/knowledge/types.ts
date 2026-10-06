import type {SourceLocation} from '../imports/types';

export interface ExtractedPage {
  pageNumber: number | null;
  text: string;
  requiresReview: boolean;
}

export interface ChunkDraft {
  index: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
  requiresReview: boolean;
}

export interface ChunkOptions {
  maxCharacters?: number;
  overlapCharacters?: number;
  maxChunks?: number;
}

export interface KnowledgeMetadata {
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED' | 'ARCHIVED' | 'REJECTED';
  isCurrent: boolean;
  approved: boolean;
  officialSource: boolean;
  extractionReviewed: boolean;
  requiresReview: boolean;
  visibility: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  archiveOnly: boolean;
  familyCode: string;
  departmentCode: string | null;
  audience: string;
  studentType: string;
  academicYear: number | null;
  semester: string | null;
  programCode: string | null;
  curriculumCode: string | null;
  cohort: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface KnowledgeScope {
  historical: boolean;
  academicYear: number | null;
  asOfDate: string | null;
  familyCodes: string[];
  departmentCode: string | null;
  audience: string | null;
  studentType: string | null;
  semester: string | null;
  programCode: string | null;
  curriculumCode: string | null;
  cohort: number | null;
}

export interface KnowledgeEvidence {
  /** Absent only on legacy saved results; fresh retrieval always proves complete rule context. */
  ruleProof?: KnowledgeRuleProof;
  /** Missing on pre-location serialized jobs; new retrieval always returns the stored array. */
  sourceLocations?: SourceLocation[];
  chunkId: string;
  documentId: string;
  documentRevision: number;
  title: string;
  familyCode: string;
  academicYear: number | null;
  authorityLevel: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
  sourceUrl: string | null;
  similarity: number;
}

export interface KnowledgeRuleProof {
  familyId:string;
  baseDocumentId:string;
  versionStream:string;
  ruleRevision:string;
  evaluationDate:string;
  contextDigest:string;
}
