import { expect, it } from 'vitest';
import { parseImportSource } from '../lib/imports/parse-source';
import { createImportSource } from '../lib/imports/source';
import {
	createMalformedPdfFixture,
	createPdfFixture,
	createScannedPdfFixture,
} from './fixtures/import-pdf';

const pdfSource = (bytes: Uint8Array) =>
	createImportSource({
		bytes,
		filename: 'supervised-fixture.pdf',
		mimeType: 'application/pdf',
		sourceUrl: null,
		acquiredFrom: 'UPLOAD',
		fetchedAt: null,
	});

it('runs the supervised PDF parser and preserves text, page/table locations, and its report', async () => {
	const source = pdfSource(
		createPdfFixture([
			{
				lines: [{ text: 'Academic calendar registration begins August 1.', y: 720 }],
				tables: [[['Item', 'Date'], ['Registration', 'August 1']]],
			},
			{ lines: [{ text: 'The examination period starts October 3.', y: 720 }] },
		]),
	);

	const result = await parseImportSource(source);

	expect(result.pages).toHaveLength(2);
	expect(result.pages[0].text).toContain('Academic calendar registration begins August 1.');
	expect(result.pages[1].text).toContain('The examination period starts October 3.');
	expect(result.locations.pages).toEqual([
		{ kind: 'PDF', pageNumber: 1, blockStart: 1, blockEnd: 1, tableIndex: null },
		{ kind: 'PDF', pageNumber: 2, blockStart: 1, blockEnd: 1, tableIndex: null },
	]);
	expect(result.tables).toContainEqual(
		expect.objectContaining({
			pageNumber: 1,
			rows: [['Item', 'Date'], ['Registration', 'August 1']],
		}),
	);
	expect(result.locations.tables).toEqual([
		{ kind: 'PDF', pageNumber: 1, blockStart: 1, blockEnd: 1, tableIndex: 1 },
	]);
	expect(result.report).toMatchObject({
		schemaVersion: 1,
		parser: { name: 'pdf-parse', version: '2.4.5' },
		inputBytes: source.bytes.byteLength,
		pages: 2,
		tables: 1,
		cells: 4,
		truncated: false,
	});
	expect(result.report.textCharacters).toBe(
		result.pages.reduce((total, page) => total + page.text.length, 0) +
			result.tables.reduce((total, table) => total + table.rows.flat().reduce((rowTotal, cell) => rowTotal + cell.length, 0), 0),
	);
	expect(result.report.warnings).toContainEqual(
		expect.objectContaining({
			code: 'TABLE_SHAPE_REVIEW',
			location: expect.objectContaining({ kind: 'PDF', pageNumber: 1 }),
			disposition: 'UNRESOLVED',
		}),
	);
}, 20_000);

it('preserves scan-like page warnings through the supervised child', async () => {
	const result = await parseImportSource(pdfSource(createScannedPdfFixture()));

	expect(result.pages).toEqual([
		expect.objectContaining({ pageNumber: 1, text: '', requiresReview: true }),
	]);
	expect(result.flags).toEqual(
		expect.arrayContaining(['OCR_REQUIRED', 'LOW_TEXT_QUALITY', 'PAGE_REVIEW_REQUIRED']),
	);
	expect(result.report.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: 'OCR_REQUIRED',
				severity: 'REVIEW',
				location: expect.objectContaining({ kind: 'PDF', pageNumber: 1 }),
				disposition: 'UNRESOLVED',
			}),
		]),
	);
}, 20_000);

it('returns only a fixed safe error for malformed PDF bytes in the supervised child', async () => {
	await expect(parseImportSource(pdfSource(createMalformedPdfFixture()))).rejects.toThrowError(
		/^IMPORT_PARSER_FAILED$/u,
	);
}, 20_000);
