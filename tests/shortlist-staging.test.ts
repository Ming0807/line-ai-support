import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, symlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildShortlistStaging, resolveContainedSourceFile } from '../scripts/knowledge/stage-shortlist';

function fixture(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from('%PDF fixture bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const row = {
    catalog_id: 'YRU-TEST-01',
    title: 'คู่มือทดสอบ',
    source_url: 'https://drive.google.com/file/d/abc/view',
    source_page_url: 'https://service.yru.ac.th/page/1',
    local_path: 'guide/sample.pdf',
    sha256,
    bytes: bytes.length,
    family_code: 'REGISTRATION_GUIDE',
    family_codes: ['REGISTRATION_GUIDE'],
    audience: null,
    academic_year: null,
    effective_from: null,
    text_quality: 'text_extractable_sample',
    extracted_characters: 100,
    extraction_note: 'Only first pages extracted',
    download_status: 'downloaded',
    integrity_verified: true,
    review_status: 'PENDING_REVIEW',
    review_flags: [] as string[],
    is_current: null,
    ...overrides,
  };
  return {
    shortlist: [row],
    manifest: [{ ...row }],
    files: { [String(row.local_path)]: bytes } as Record<string,Uint8Array|null>,
    root: 'C:\\fixture\\documents\\yru',
  };
}

describe('buildShortlistStaging', () => {
  it('builds pending-only metadata with source provenance and unresolved review fields', () => {
    const input = fixture();
    const [document] = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root).documents;

    expect(document).toMatchObject({
      status: 'PENDING_REVIEW',
      isCurrent: null,
      catalogId: 'YRU-TEST-01',
      sourceUrl: 'https://drive.google.com/file/d/abc/view',
      sourcePageUrl: 'https://service.yru.ac.th/page/1',
      localPath: 'guide/sample.pdf',
      audience: null,
      effectiveFrom: null,
      authority: null,
      requiresReview: true,
    });
    expect(document.reviewFlags).toContain('EFFECTIVE_DATE_UNVERIFIED');
    expect(document.reviewFlags).toContain('AUTHORITY_UNVERIFIED');
    expect(JSON.stringify(document)).not.toContain('fixture bytes');
  });

  it('rejects traversal and absolute local paths', () => {
    for (const localPath of ['../secret.pdf', '..\\secret.pdf', 'C:\\secret.pdf', 'folder/file:stream.pdf', 'bad\u0000name.pdf']) {
      const input = fixture({ local_path: localPath });
      expect(() => buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root))
        .toThrowError('STAGING_PATH_INVALID');
    }
  });

  it('rejects shortlist rows that do not match the authoritative manifest', () => {
    const input = fixture();
    input.manifest[0].sha256 = '0'.repeat(64);
    expect(() => buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root))
      .toThrowError('STAGING_MANIFEST_MISMATCH');
  });

  it('rejects content whose bytes fail the manifest checksum', () => {
    const input = fixture();
    input.files['guide/sample.pdf'] = Buffer.from('tampered fixture');
    expect(() => buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root))
      .toThrowError('STAGING_CHECKSUM_MISMATCH');
  });

  it('requires an official YRU source page URL', () => {
    const input = fixture({ source_page_url: 'https://example.com/source' });
    expect(() => buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root))
      .toThrowError('STAGING_SOURCE_NOT_OFFICIAL');
  });

  it('rejects official-looking source pages with credentials or a non-default port', () => {
    for (const sourcePageUrl of [
      'https://user@service.yru.ac.th/page/1',
      'https://service.yru.ac.th:8443/page/1',
    ]) {
      const input = fixture({ source_page_url: sourcePageUrl });
      expect(() => buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root))
        .toThrowError('STAGING_SOURCE_NOT_OFFICIAL');
    }
  });

  it('retains a valid external resource URL as pending with a review flag', () => {
    const input = fixture({ source_url: 'https://drive.google.com/file/d/abc/view' });
    const [document] = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root).documents;
    expect(document.sourceUrl).toBe('https://drive.google.com/file/d/abc/view');
    expect(document.status).toBe('PENDING_REVIEW');
    expect(document.reviewFlags).toContain('SOURCE_URL_EXTERNAL');
  });

  it('resolves source files through symlinks and rejects a target outside the corpus', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'yru-stage-'));
    const root = path.join(temp, 'corpus');
    const outside = path.join(temp, 'outside');
    try {
      await mkdir(root);
      await mkdir(outside);
      await writeFile(path.join(outside, 'linked.pdf'), 'outside');
      await symlink(outside, path.join(root, 'linked'), 'junction');
      await expect(resolveContainedSourceFile(root, 'linked/linked.pdf')).rejects.toThrowError('STAGING_PATH_INVALID');
      const inside = path.join(root, 'inside.pdf');
      await writeFile(inside, 'inside');
      expect(await resolveContainedSourceFile(root, 'inside.pdf')).toBe(await realpath(inside));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it('keeps unavailable extraction metadata pending with explicit review flags', () => {
    const input = fixture({ text_quality: null, extracted_characters: null, extraction_note: null });
    const [document] = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root).documents;
    expect(document.status).toBe('PENDING_REVIEW');
    expect(document.requiresReview).toBe(true);
    expect(document.reviewFlags).toContain('EXTRACTION_QUALITY_UNKNOWN');
    expect(document.reviewFlags).toContain('MANUAL_EXTRACTION_REVIEW_REQUIRED');
  });

  it('keeps a missing local source pending and reports missing-file provenance', () => {
    const input = fixture();
    input.files['guide/sample.pdf'] = null;
    const staging = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root);
    expect(staging.documents[0].status).toBe('PENDING_REVIEW');
    expect(staging.documents[0].extraction.integrityVerified).toBe(false);
    expect(staging.documents[0].reviewFlags).toContain('SOURCE_FILE_MISSING');
    expect(staging.report.missingFiles).toBe(1);
  });

  it('deduplicates identical content and keeps multiple families classification-pending', () => {
    const input = fixture();
    const second = { ...input.shortlist[0], catalog_id: 'YRU-TEST-02', family_code: 'WIFI_GUIDE', family_codes: ['WIFI_GUIDE'] };
    input.shortlist.push(second);
    input.manifest.push({ ...second });
    const staging = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root);
    expect(staging.documents).toHaveLength(1);
    expect(staging.documents[0].familyCodes).toEqual(['REGISTRATION_GUIDE', 'WIFI_GUIDE']);
    expect(staging.documents[0].classificationStatus).toBe('PENDING_CLASSIFICATION');
    expect(staging.documents[0].sources).toHaveLength(2);
  });

  it('unions manifest review flags from every deduplicated source', () => {
    const input = fixture();
    input.manifest[0].review_flags = ['SOURCE_MANUAL_REVIEW'];
    input.shortlist[0].review_flags = ['SOURCE_MANUAL_REVIEW'];
    const second = { ...input.shortlist[0], catalog_id: 'YRU-TEST-02', family_code: 'WIFI_GUIDE', family_codes: ['WIFI_GUIDE'] };
    input.shortlist.push(second);
    input.manifest.push({ ...second, text_quality: 'scanned_pdf_may_need_OCR', review_flags: ['SECOND_SOURCE_OCR_REVIEW'] });
    const staging = buildShortlistStaging(input.shortlist as never, input.manifest as never, input.files, input.root);
    expect(staging.documents[0].reviewFlags).toContain('SOURCE_MANUAL_REVIEW');
    expect(staging.documents[0].reviewFlags).toContain('SECOND_SOURCE_OCR_REVIEW');
    expect(staging.documents[0].reviewFlags).toContain('OCR_OR_EXTRACTION_REVIEW_REQUIRED');
    expect(staging.documents[0].sources[1].reviewFlags).toContain('SECOND_SOURCE_OCR_REVIEW');
    expect(staging.documents[0].status).toBe('PENDING_REVIEW');
  });
});
