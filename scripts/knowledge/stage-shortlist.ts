import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Resource = Record<string, unknown>;
type SourceFileMap = Record<string, Uint8Array | null>;

export interface StagedSource {
  catalogId: string;
  title: string;
  sourceUrl: string;
  sourcePageUrl: string;
  localPath: string;
  sha256: string;
  pageCount: number | null;
  familyCodes: string[];
  integrityVerified: boolean;
  sourceFilePresent: boolean;
  reviewFlags: string[];
}

export interface StagedDocument {
  catalogId: string;
  title: string;
  sourceUrl: string;
  sourcePageUrl: string;
  sha256: string;
  localPath: string;
  familyCodes: string[];
  classificationStatus: 'PENDING_REVIEW' | 'PENDING_CLASSIFICATION';
  category: string | null;
  audience: string | null;
  academicYear: number | null;
  effectiveFrom: string | null;
  authority: null;
  extraction: {
    textQuality: string | null;
    extractedCharacters: number | null;
    pageCount: number | null;
    extractionNote: string | null;
    integrityVerified: boolean;
    sourceFilePresent: boolean;
  };
  status: 'PENDING_REVIEW';
  isCurrent: null;
  requiresReview: true;
  reviewFlags: string[];
  sources: StagedSource[];
}

export interface StagingReport {
  shortlistResources: number;
  stagedDocuments: number;
  deduplicatedResources: number;
  missingFiles: number;
  suspectedOcr: number;
  manualReviewFields: number;
}

export interface ShortlistStaging {
  schemaVersion: 1;
  status: 'PENDING_REVIEW';
  documents: StagedDocument[];
  report: StagingReport;
}

const MANIFEST_MATCH_FIELDS = [
  'catalog_id', 'title', 'source_url', 'source_page_url', 'local_path', 'sha256',
] as const;

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown): value is Resource {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(row: Resource, key: string): string | null {
  return typeof row[key] === 'string' && row[key].trim() ? row[key].trim() as string : null;
}

function stringList(row: Resource, primary: string, fallback: string): string[] {
  const values = Array.isArray(row[primary]) ? row[primary] : [];
  const one = stringField(row, fallback);
  return [...new Set([...values.filter((value): value is string => typeof value === 'string' && value.length > 0), ...(one ? [one] : [])])].sort();
}

function safeAbsolutePath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/[\\/]+/gu, '/');
  const win = path.win32;
  if (!normalized || relativePath.includes('\u0000') || normalized.includes(':') || path.isAbsolute(relativePath) || win.isAbsolute(relativePath) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('STAGING_PATH_INVALID');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const rel = path.relative(resolvedRoot, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('STAGING_PATH_INVALID');
  return resolved;
}

function isOfficialYruUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'yru.ac.th' || url.hostname.endsWith('.yru.ac.th'));
  } catch {
    return false;
  }
}

function reviewFlagsForSource(manifest: Resource): string[] {
  const flags = new Set<string>(Array.isArray(manifest.review_flags)
    ? manifest.review_flags.filter((flag): flag is string => typeof flag === 'string' && flag.length > 0)
    : []);
  const quality = stringField(manifest, 'text_quality');
  const extractedCharacters = typeof manifest.extracted_characters === 'number' ? manifest.extracted_characters : null;
  if (!stringField(manifest, 'audience')) flags.add('AUDIENCE_UNVERIFIED');
  if (typeof manifest.academic_year !== 'number') flags.add('ACADEMIC_YEAR_UNVERIFIED');
  if (manifest.effective_from == null) flags.add('EFFECTIVE_DATE_UNVERIFIED');
  flags.add('AUTHORITY_UNVERIFIED');
  if (!quality) flags.add('EXTRACTION_QUALITY_UNKNOWN');
  if (quality && /ocr|scan|image|broken|unreadable/iu.test(quality)) flags.add('OCR_OR_EXTRACTION_REVIEW_REQUIRED');
  if (manifest.extraction_note || typeof extractedCharacters !== 'number' || extractedCharacters === 0) {
    flags.add('MANUAL_EXTRACTION_REVIEW_REQUIRED');
  }
  if (manifest.integrity_verified !== true) flags.add('MANIFEST_INTEGRITY_UNVERIFIED');
  const sourceUrl = stringField(manifest, 'source_url');
  if (sourceUrl && !isOfficialYruUrl(sourceUrl)) flags.add('SOURCE_URL_EXTERNAL');
  return [...flags].sort();
}

/** Resolve through filesystem links and return only paths contained by the corpus realpath. */
export async function resolveContainedSourceFile(corpusRoot: string, relativePath: string): Promise<string | null> {
  const lexicalPath = safeAbsolutePath(corpusRoot, relativePath);
  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(corpusRoot), realpath(lexicalPath)]);
    const rel = path.relative(resolvedRoot, resolvedFile);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('STAGING_PATH_INVALID');
    return resolvedFile;
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return null;
    if (error instanceof Error && error.message === 'STAGING_PATH_INVALID') throw error;
    fail('STAGING_PATH_INVALID');
  }
}

function validateManifestMatch(shortlistRow: Resource, manifestRow: Resource): void {
  for (const field of MANIFEST_MATCH_FIELDS) {
    if (shortlistRow[field] !== manifestRow[field]) fail('STAGING_MANIFEST_MISMATCH');
  }
  const shortlistFamilies = stringList(shortlistRow, 'family_codes', 'family_code');
  const manifestFamilies = stringList(manifestRow, 'family_codes', 'family_code');
  if (JSON.stringify(shortlistFamilies) !== JSON.stringify(manifestFamilies)) fail('STAGING_MANIFEST_MISMATCH');
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeDocument(rows: Array<{ shortlist: Resource; manifest: Resource; bytes: Uint8Array | null }>): StagedDocument {
  const { manifest, bytes } = rows[0];
  const allFilesPresent = rows.every(({ bytes: sourceBytes }) => sourceBytes !== null);
  const families = [...new Set(rows.flatMap(({ shortlist: item, manifest: full }) => [
    ...stringList(item, 'family_codes', 'family_code'),
    ...stringList(full, 'family_codes', 'family_code'),
  ]))].sort();
  const expectedHash = stringField(manifest, 'sha256');
  if (!expectedHash || !/^[a-f0-9]{64}$/iu.test(expectedHash)) fail('STAGING_INPUT_INVALID');
  if (bytes && digest(bytes) !== expectedHash.toLowerCase()) fail('STAGING_CHECKSUM_MISMATCH');
  if (bytes && typeof manifest.bytes === 'number' && bytes.byteLength !== manifest.bytes) fail('STAGING_CHECKSUM_MISMATCH');

  const quality = stringField(manifest, 'text_quality');
  const extractedCharacters = typeof manifest.extracted_characters === 'number' ? manifest.extracted_characters : null;
  const pageCount = typeof manifest.page_count === 'number' ? manifest.page_count : null;
  const flags = new Set<string>(rows.flatMap(({ manifest: sourceManifest }) => reviewFlagsForSource(sourceManifest)));
  if (families.length > 1) flags.add('MULTIPLE_FAMILIES_REQUIRE_CLASSIFICATION');
  if (!allFilesPresent) flags.add('SOURCE_FILE_MISSING');

  const localPath = stringField(manifest, 'local_path');
  if (!localPath) fail('STAGING_INPUT_INVALID');
  const sources: StagedSource[] = rows.map(({ shortlist: item, manifest: full, bytes: sourceBytes }) => ({
    catalogId: stringField(item, 'catalog_id') ?? fail('STAGING_INPUT_INVALID'),
    title: stringField(full, 'title') ?? fail('STAGING_INPUT_INVALID'),
    sourceUrl: stringField(full, 'source_url') ?? fail('STAGING_INPUT_INVALID'),
    sourcePageUrl: stringField(full, 'source_page_url') ?? fail('STAGING_INPUT_INVALID'),
    localPath: stringField(full, 'local_path') ?? fail('STAGING_INPUT_INVALID'),
    sha256: stringField(full, 'sha256') ?? fail('STAGING_INPUT_INVALID'),
    pageCount: typeof full.page_count === 'number' ? full.page_count : null,
    familyCodes: stringList(full, 'family_codes', 'family_code'),
    integrityVerified: full.integrity_verified === true && sourceBytes !== null,
    sourceFilePresent: sourceBytes !== null,
    reviewFlags: reviewFlagsForSource(full),
  }));

  return {
    catalogId: stringField(rows[0].shortlist, 'catalog_id') ?? fail('STAGING_INPUT_INVALID'),
    title: stringField(manifest, 'title') ?? fail('STAGING_INPUT_INVALID'),
    sourceUrl: stringField(manifest, 'source_url') ?? fail('STAGING_INPUT_INVALID'),
    sourcePageUrl: stringField(manifest, 'source_page_url') ?? fail('STAGING_INPUT_INVALID'),
    sha256: expectedHash.toLowerCase(),
    localPath,
    familyCodes: families,
    classificationStatus: families.length > 1 ? 'PENDING_CLASSIFICATION' : 'PENDING_REVIEW',
    category: stringField(manifest, 'category'),
    audience: stringField(manifest, 'audience'),
    academicYear: typeof manifest.academic_year === 'number' ? manifest.academic_year : null,
    effectiveFrom: typeof manifest.effective_from === 'string' ? manifest.effective_from : null,
    authority: null,
    extraction: {
      textQuality: quality,
      extractedCharacters,
      pageCount,
      extractionNote: stringField(manifest, 'extraction_note'),
      integrityVerified: manifest.integrity_verified === true && allFilesPresent,
      sourceFilePresent: allFilesPresent,
    },
    status: 'PENDING_REVIEW',
    isCurrent: null,
    requiresReview: true,
    reviewFlags: [...flags].sort(),
    sources,
  };
}

/** Purely transforms shortlist and manifest data plus caller-provided file bytes into a safe staging DTO. */
export function buildShortlistStaging(
  shortlist: unknown,
  manifest: unknown,
  files: SourceFileMap,
  corpusRoot: string,
): ShortlistStaging {
  if (!Array.isArray(shortlist) || !Array.isArray(manifest) || !files || typeof files !== 'object' || typeof corpusRoot !== 'string') {
    fail('STAGING_INPUT_INVALID');
  }

  const manifestByCatalogId = new Map<string, Resource>();
  for (const item of manifest) {
    if (!record(item)) fail('STAGING_INPUT_INVALID');
    const catalogId = stringField(item, 'catalog_id');
    if (catalogId) manifestByCatalogId.set(catalogId, item);
  }

  const grouped = new Map<string, Array<{ shortlist: Resource; manifest: Resource; bytes: Uint8Array | null }>>();
  for (const item of shortlist) {
    if (!record(item)) fail('STAGING_INPUT_INVALID');
    const id = stringField(item, 'catalog_id');
    const full = id ? manifestByCatalogId.get(id) : undefined;
    if (!full) fail('STAGING_MANIFEST_MISMATCH');
    validateManifestMatch(item, full);
    const sourcePageUrl = stringField(full, 'source_page_url');
    if (!isOfficialYruUrl(sourcePageUrl)) fail('STAGING_SOURCE_NOT_OFFICIAL');
    const localPath = stringField(full, 'local_path');
    if (!localPath) fail('STAGING_INPUT_INVALID');
    safeAbsolutePath(corpusRoot, localPath);
    const supplied = files[localPath];
    if (supplied !== undefined && supplied !== null && !(supplied instanceof Uint8Array)) fail('STAGING_INPUT_INVALID');
    const hash = stringField(full, 'sha256');
    if (!hash) fail('STAGING_INPUT_INVALID');
    if (supplied && digest(supplied) !== hash.toLowerCase()) fail('STAGING_CHECKSUM_MISMATCH');
    if (supplied && typeof full.bytes === 'number' && supplied.byteLength !== full.bytes) fail('STAGING_CHECKSUM_MISMATCH');
    const group = grouped.get(hash.toLowerCase()) ?? [];
    group.push({ shortlist: item, manifest: full, bytes: supplied ?? null });
    grouped.set(hash.toLowerCase(), group);
  }

  const documents = [...grouped.values()].map(makeDocument);
  const missingFiles = documents.filter(({ extraction }) => !extraction.sourceFilePresent).length;
  const suspectedOcr = documents.filter(({ reviewFlags }) => reviewFlags.includes('OCR_OR_EXTRACTION_REVIEW_REQUIRED')).length;
  const manualReviewFields = documents.filter(({ reviewFlags }) => reviewFlags.some((flag) =>
    flag === 'AUDIENCE_UNVERIFIED' || flag === 'ACADEMIC_YEAR_UNVERIFIED' || flag === 'EFFECTIVE_DATE_UNVERIFIED' || flag === 'AUTHORITY_UNVERIFIED' || flag === 'MANUAL_EXTRACTION_REVIEW_REQUIRED' || flag === 'EXTRACTION_QUALITY_UNKNOWN',
  )).length;

  return {
    schemaVersion: 1,
    status: 'PENDING_REVIEW',
    documents,
    report: {
      shortlistResources: shortlist.length,
      stagedDocuments: documents.length,
      deduplicatedResources: shortlist.length - documents.length,
      missingFiles,
      suspectedOcr,
      manualReviewFields,
    },
  };
}

async function runCli(): Promise<void> {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const corpusRoot = path.join(workspaceRoot, 'documents', 'yru');
  const shortlist = JSON.parse(await readFile(path.join(corpusRoot, 'demo-shortlist.json'), 'utf8')) as unknown;
  const manifest = JSON.parse(await readFile(path.join(corpusRoot, 'manifest.json'), 'utf8')) as unknown;
  if (!Array.isArray(shortlist)) fail('STAGING_INPUT_INVALID');
  const files: SourceFileMap = {};
  for (const item of shortlist) {
    if (!record(item) || typeof item.local_path !== 'string') fail('STAGING_INPUT_INVALID');
    const fullPath = await resolveContainedSourceFile(corpusRoot, item.local_path);
    files[item.local_path] = fullPath ? await readFile(fullPath) : null;
  }

  const staging = buildShortlistStaging(shortlist, manifest, files, corpusRoot);
  const outputPath = path.join(workspaceRoot, '.superpowers', 'staging', 'm6-shortlist.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(staging, null, 2)}\n`, 'utf8');
  console.log(`M6 shortlist staging saved (${staging.report.stagedDocuments} documents; ${staging.report.missingFiles} missing files, ${staging.report.suspectedOcr} OCR/extraction flags, ${staging.report.manualReviewFields} records with manual review fields). Status: PENDING_REVIEW.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error: unknown) => {
    const code = error instanceof Error && /^STAGING_[A-Z_]+$/u.test(error.message) ? error.message : 'STAGING_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
