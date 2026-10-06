import { PDFParse } from 'pdf-parse';
import { expect, it, vi } from 'vitest';
import { parsePdfSource } from '../lib/imports/pdf-parser';
import { createImportSource } from '../lib/imports/source';
import { IMPORT_LIMITS, type ImportSource } from '../lib/imports/types';
import {
	createMalformedPdfFixture,
	createOversizedTextPdfFixture,
	createPdfFixture,
	createReplacementPdfFixture,
	createScannedPdfFixture,
} from './fixtures/import-pdf';

const pdfSource = (bytes: Uint8Array): ImportSource =>
	createImportSource({
		bytes,
		filename: 'fixture.pdf',
		mimeType: 'application/pdf',
		sourceUrl: null,
		acquiredFrom: 'UPLOAD',
		fetchedAt: null,
	});

it('extracts each physical page with one-based page and block locations', async () => {
	const source = pdfSource(
		createPdfFixture([
			{
				lines: [
					{ text: 'Academic Calendar', size: 18, y: 720 },
					{ text: 'Registration opens August 1.', size: 11, y: 690 },
				],
			},
			{ lines: [{ text: 'Exam period starts October 3.', size: 12, y: 720 }] },
		]),
	);

	const result = await parsePdfSource(source);

	expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
	expect(result.pages[0].text).toContain('Academic Calendar');
	expect(result.pages[0].text).toContain('Registration opens August 1.');
	expect(result.pages[1].text).toContain('Exam period starts October 3.');
	expect(result.locations.pages).toEqual([
		{ kind: 'PDF', pageNumber: 1, blockStart: 1, blockEnd: 1, tableIndex: null },
		{ kind: 'PDF', pageNumber: 2, blockStart: 1, blockEnd: 1, tableIndex: null },
	]);
	expect(result.report).toMatchObject({
		schemaVersion: 1,
		parser: { name: 'pdf-parse', version: '2.4.5' },
		inputBytes: source.bytes.byteLength,
		pages: 2,
		tables: 0,
		truncated: false,
	});
	expect(result.report.warnings.every((warning) => warning.disposition === 'UNRESOLVED')).toBe(true);
});

it('returns detected ruled-table cells verbatim with their physical page and table index', async () => {
	const source = pdfSource(
		createPdfFixture([
			{
				tables: [[
					['Activity', 'Date', 'Note'],
					['Registration', 'August 1', ''],
				]],
			},
		]),
	);

	const result = await parsePdfSource(source);

	expect(result.tables).toEqual([
		{
			pageNumber: 1,
			sectionTitle: null,
			sheetName: null,
			firstRow: 1,
			rows: [
				['Activity', 'Date', 'Note'],
				['Registration', 'August 1', ''],
			],
		},
	]);
	expect(result.locations.tables).toEqual([
		{ kind: 'PDF', pageNumber: 1, blockStart: 1, blockEnd: 1, tableIndex: 1 },
	]);
	expect(result.flags).toContain('TABLE_SHAPE_REVIEW');
	expect(result.report.warnings).toContainEqual(
		expect.objectContaining({
			code: 'TABLE_SHAPE_REVIEW',
			location: expect.objectContaining({ kind: 'PDF', pageNumber: 1 }),
			disposition: 'UNRESOLVED',
		}),
	);
});

it('marks a textless scan-like page for OCR and human review without claiming OCR ran', async () => {
	const source = pdfSource(createScannedPdfFixture());

	const result = await parsePdfSource(source);

	expect(result.pages).toEqual([
		expect.objectContaining({ pageNumber: 1, text: '', requiresReview: true }),
	]);
	expect(result.flags).toContain('OCR_REQUIRED');
	expect(result.flags).toContain('LOW_TEXT_QUALITY');
	expect(result.flags).toContain('PAGE_REVIEW_REQUIRED');
	expect(result.report.warnings.every((warning) =>
		warning.disposition === 'UNRESOLVED' && warning.location?.kind === 'PDF' && warning.location.pageNumber === 1,
	)).toBe(true);
});

it('reports replacement characters as unresolved low-quality evidence', async () => {
	const source = pdfSource(createReplacementPdfFixture());

	const result = await parsePdfSource(source);

	expect(result.report.replacementCharacters).toBeGreaterThan(0);
	expect(result.flags).toContain('LOW_TEXT_QUALITY');
	expect(result.flags).toContain('PAGE_REVIEW_REQUIRED');
	expect(result.report.warnings).toContainEqual(
		expect.objectContaining({
			code: 'LOW_TEXT_QUALITY',
			location: expect.objectContaining({ kind: 'PDF', pageNumber: 1 }),
			disposition: 'UNRESOLVED',
		}),
	);
});

it('rejects malformed PDFs with a fixed error and destroys the parser', async () => {
	const source = pdfSource(createMalformedPdfFixture());
	const destroy = vi.spyOn(PDFParse.prototype, 'destroy');

	try {
		await expect(parsePdfSource(source)).rejects.toThrowError(/^IMPORT_PARSE_INVALID$/u);
		expect(destroy).toHaveBeenCalledTimes(1);
	} finally {
		destroy.mockRestore();
	}
});

it('rejects page-count and extracted-text overflows with the same fixed error', async () => {
	const tooManyPages = pdfSource(createPdfFixture(Array.from({ length: IMPORT_LIMITS.pages + 1 }, () => ({}))));
	await expect(parsePdfSource(tooManyPages)).rejects.toThrowError(/^IMPORT_PARSE_INVALID$/u);

	const tooMuchText = pdfSource(createOversizedTextPdfFixture(IMPORT_LIMITS.characters + 1));
	await expect(parsePdfSource(tooMuchText)).rejects.toThrowError(/^IMPORT_PARSE_INVALID$/u);
}, 20_000);

it('destroys the parser when the caller cancels an in-flight parse', async () => {
	const controller = new AbortController();
	const destroy = vi.spyOn(PDFParse.prototype, 'destroy');
	const parsing = parsePdfSource(
		pdfSource(createPdfFixture([{ lines: [{ text: 'Cancellation fixture' }] }])),
		controller.signal,
	);
	controller.abort();

	try {
		await expect(parsing).rejects.toThrowError(/^IMPORT_PARSE_INVALID$/u);
		expect(destroy).toHaveBeenCalledTimes(1);
	} finally {
		destroy.mockRestore();
	}
});

it('retains independently read pages and successful page tables when another page table detector fails', async () => {
 const source=pdfSource(createPdfFixture([
  {lines:[{text:'Retained text from a page with unsupported table geometry.'}]},
  {lines:[{text:'Reviewed table page.'}],tables:[[['Item','Amount'],['Fee','001.20']]]},
 ]));
 const original=PDFParse.prototype.getTable;
 const table=vi.spyOn(PDFParse.prototype,'getTable').mockImplementation(function(this:PDFParse,parameters){
  if(!parameters?.partial||parameters.partial.includes(1))return Promise.reject(new TypeError('Synthetic private upstream geometry diagnostic'));
  return original.call(this,parameters);
 });
 try{
  const result=await parsePdfSource(source);
  expect(result.pages[0]).toMatchObject({pageNumber:1,text:expect.stringContaining('Retained text'),requiresReview:true});
  expect(result.pages[1].text).toContain('Reviewed table page.');
  expect(result.tables).toEqual([expect.objectContaining({pageNumber:2,rows:[['Item','Amount'],['Fee','001.20']]})]);
  expect(result.locations.tables).toEqual([{kind:'PDF',pageNumber:2,blockStart:1,blockEnd:1,tableIndex:1}]);
  expect(result.flags).toContain('UNSUPPORTED_TABLES');
  expect(result.report.warnings).toContainEqual(expect.objectContaining({code:'UNSUPPORTED_TABLES',severity:'BLOCKING',location:expect.objectContaining({kind:'PDF',pageNumber:1}),disposition:'UNRESOLVED'}));
  expect(result.report.truncated).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private upstream geometry diagnostic');
 }finally{table.mockRestore();}
});

it('preserves every nonempty detected row and exact cell while flagging empty table geometry for review', async () => {
 const source=pdfSource(createPdfFixture([{lines:[{text:'All original page text is retained.'}]}]));
 const table=vi.spyOn(PDFParse.prototype,'getTable').mockResolvedValue({total:1,pages:[{num:1,tables:[[],[[],['Item','Amount'],[],['Fee','001.20'],['','']]]}],mergedTables:[]});
 try{
  const result=await parsePdfSource(source);
  expect(result.pages[0]).toMatchObject({text:expect.stringContaining('All original'),requiresReview:true});
  expect(result.tables).toEqual([
   expect.objectContaining({firstRow:2,rows:[['Item','Amount']]}),
   expect.objectContaining({firstRow:4,rows:[['Fee','001.20'],['','']]}),
  ]);
  expect(result.locations.tables).toEqual([
   expect.objectContaining({kind:'PDF',pageNumber:1,tableIndex:1}),
   expect.objectContaining({kind:'PDF',pageNumber:1,tableIndex:2}),
  ]);
  expect(result.report.cells).toBe(6);
  expect(result.report.warnings).toContainEqual(expect.objectContaining({code:'UNSUPPORTED_TABLES',severity:'BLOCKING',location:expect.objectContaining({kind:'PDF',pageNumber:1}),count:3,disposition:'UNRESOLVED'}));
  expect(result.flags).toContain('TABLE_SHAPE_REVIEW');
 }finally{table.mockRestore();}
});
