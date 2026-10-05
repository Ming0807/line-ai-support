import { PDFParse } from 'pdf-parse';
import { validateLocatedExtraction } from './extraction';
import { verifyImportSource } from './source';
import {
	IMPORT_LIMITS,
	type Extraction,
	type ExtractionWarning,
	type ImportSource,
	type LocatedExtraction,
	type SourceLocation,
} from './types';

const PARSER_NAME = 'pdf-parse';
const PARSER_VERSION = '2.4.5'; // Keep aligned with the exact root dependency pin.
const invalid = (): never => {
	throw new Error('IMPORT_PARSE_INVALID');
};
const parseParameters = {
	lineEnforce: true,
	pageJoiner: '',
} as const;

function countReplacements(value: string): number {
	let count = 0;
	for (const character of value) if (character === '\uFFFD') count++;
	return count;
}

function candidateHeading(pageText: string): string | null {
	const lines = pageText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
	if (lines.length < 2) return null;
	const first = lines[0];
	if (first.length > 200 || first.includes('\t') || /[.!?;:]$/u.test(first)) return null;
	return first;
}

function pdfLocation(pageNumber: number, tableIndex: number | null): SourceLocation {
	return { kind: 'PDF', pageNumber, blockStart: 1, blockEnd: 1, tableIndex };
}

interface PageText {
	num: number;
	text: string;
}

function buildExtraction(
	source: ImportSource,
	pageTexts: readonly PageText[],
	tablePages: readonly { num: number; tables: string[][][] }[],
	pageLinks: readonly { pageNumber: number; links: readonly unknown[] }[],
	hasExternalOutline: boolean,
): LocatedExtraction {
	if (pageTexts.length < 1 || pageTexts.length > IMPORT_LIMITS.pages) return invalid();
	if (pageTexts.some((page, index) => page.num !== index + 1 || typeof page.text !== 'string')) return invalid();

	const tablePageMap = new Map<number, string[][][]>();
	for (const page of tablePages) {
		if (!Number.isInteger(page.num) || page.num < 1 || page.num > pageTexts.length || tablePageMap.has(page.num)) return invalid();
		tablePageMap.set(page.num, page.tables);
	}

	const pages: Extraction['pages'] = [];
	const pageLocations: SourceLocation[] = [];
	const tables: Extraction['tables'] = [];
	const tableLocations: SourceLocation[] = [];
	const flags = new Set<Extraction['flags'][number]>();
	const pageWarnings = new Map<number, Map<Extraction['flags'][number], number>>();
	const globalWarningCounts = new Map<Extraction['flags'][number], number>();
	const reviewPages = new Set<number>();
	const pageReviewWarnings = new Set<number>();
	let cells = 0;
	let characters = 0;
	let replacements = 0;

	const addPageWarning = (code: Extraction['flags'][number], pageNumber: number, count = 1): void => {
		flags.add(code);
		const warnings = pageWarnings.get(pageNumber) ?? new Map<Extraction['flags'][number], number>();
		warnings.set(code, (warnings.get(code) ?? 0) + count);
		pageWarnings.set(pageNumber, warnings);
	};
	const addGlobalWarning = (code: Extraction['flags'][number], count = 1): void => {
		flags.add(code);
		globalWarningCounts.set(code, (globalWarningCounts.get(code) ?? 0) + count);
	};
	const markPageReview = (pageNumber: number): void => {
		reviewPages.add(pageNumber);
		if (pageReviewWarnings.has(pageNumber)) return;
		pageReviewWarnings.add(pageNumber);
		addPageWarning('PAGE_REVIEW_REQUIRED', pageNumber);
	};

	for (const page of pageTexts) {
		const tableRows = tablePageMap.get(page.num) ?? [];
		let pageTableCount = 0;
		let pageCellCharacters = 0;
		let pageReplacementCount = countReplacements(page.text);
		characters += page.text.length;
		if (characters > IMPORT_LIMITS.characters) return invalid();

		for (const candidate of tableRows) {
			if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > IMPORT_LIMITS.rows) return invalid();
			const rows: string[][] = [];
			let width: number | null = null;
			let irregular = false;
			for (const row of candidate) {
				if (!Array.isArray(row) || row.length < 1 || row.length > IMPORT_LIMITS.columns) return invalid();
				if (width === null) width = row.length;
				else if (width !== row.length) irregular = true;
				const exactRow: string[] = [];
				for (const cell of row) {
					if (typeof cell !== 'string' || cell.length > IMPORT_LIMITS.cellCharacters) return invalid();
					cells++;
					pageCellCharacters += cell.length;
					characters += cell.length;
					pageReplacementCount += countReplacements(cell);
					if (cells > IMPORT_LIMITS.cells || characters > IMPORT_LIMITS.characters) return invalid();
					exactRow.push(cell);
				}
				rows.push(exactRow);
			}
			if (tables.length >= IMPORT_LIMITS.tables) return invalid();
			if (irregular) {
				addPageWarning('UNSUPPORTED_TABLES', page.num);
				markPageReview(page.num);
			}
			const tableIndex = tables.length + 1;
			tables.push({ pageNumber: page.num, sectionTitle: null, sheetName: null, firstRow: 1, rows });
			tableLocations.push(pdfLocation(page.num, tableIndex));
			pageTableCount++;
		}

		const hasText = page.text.trim().length > 0 || pageCellCharacters > 0;
		const replacementCount = pageReplacementCount;
		replacements += replacementCount;
		const heading = candidateHeading(page.text);
		const sparseText = (page.text.trim().length + pageCellCharacters) < 20;
		const needsLowQualityReview = !hasText || sparseText || replacementCount > 0;
		if (replacementCount > 0) {
			addPageWarning('LOW_TEXT_QUALITY', page.num, replacementCount);
			markPageReview(page.num);
		}
		if (!hasText) {
			addPageWarning('OCR_REQUIRED', page.num);
			markPageReview(page.num);
		}
		if (needsLowQualityReview && replacementCount === 0) {
			addPageWarning('LOW_TEXT_QUALITY', page.num);
			markPageReview(page.num);
		}
		if (heading !== null) {
			markPageReview(page.num);
		}
		if (pageTableCount > 0) {
			addPageWarning('TABLE_SHAPE_REVIEW', page.num, pageTableCount);
			markPageReview(page.num);
		}
		if (page.text.includes('\t') && pageTableCount === 0) {
			addPageWarning('UNSUPPORTED_TABLES', page.num);
			addPageWarning('TABLE_SHAPE_REVIEW', page.num);
			markPageReview(page.num);
		}
		const linkCount = pageLinks.find((item) => item.pageNumber === page.num)?.links.length ?? 0;
		if (linkCount > 0) {
			addPageWarning('EXTERNAL_LINKS_REVIEW', page.num, linkCount);
			markPageReview(page.num);
		}

		pages.push({ pageNumber: page.num, text: page.text, requiresReview: reviewPages.has(page.num), sectionTitle: heading });
		pageLocations.push(pdfLocation(page.num, null));
	}

	if (tables.length > IMPORT_LIMITS.tables || cells > IMPORT_LIMITS.cells || characters > IMPORT_LIMITS.characters) return invalid();
	if (replacementCountTotal(pageTexts, tables) !== replacements) return invalid();
	if (hasExternalOutline) addGlobalWarning('EXTERNAL_LINKS_REVIEW');
	const title = pages[0]?.sectionTitle ?? null;
	const warningRecords: ExtractionWarning[] = [];
	for (const [pageNumber, pageWarningCounts] of pageWarnings) {
		for (const [code, count] of pageWarningCounts) {
			warningRecords.push({
				code,
				severity: code === 'UNSUPPORTED_TABLES' ? 'BLOCKING' : 'REVIEW',
				location: pdfLocation(pageNumber, null),
				count: Math.max(1, Math.min(count, IMPORT_LIMITS.characters)),
				disposition: 'UNRESOLVED',
			});
		}
	}
	for (const [code, count] of globalWarningCounts) {
		warningRecords.push({
			code,
			severity: code === 'UNSUPPORTED_TABLES' ? 'BLOCKING' : 'REVIEW',
			location: null,
			count: Math.max(1, Math.min(count, IMPORT_LIMITS.characters)),
			disposition: 'UNRESOLVED',
		});
	}
	let warnings = warningRecords;
	if (warnings.length > 1000) {
		const retained = warnings.slice(0, 990);
		const overflowCounts = new Map<ExtractionWarning['code'], number>();
		for (const warning of warnings.slice(990)) overflowCounts.set(warning.code, (overflowCounts.get(warning.code) ?? 0) + warning.count);
		warnings = [
			...retained,
			...[...overflowCounts.entries()].map(([code, count]) => ({
				code,
				severity: code === 'UNSUPPORTED_TABLES' ? 'BLOCKING' as const : 'REVIEW' as const,
				location: null,
				count: Math.max(1, Math.min(count, IMPORT_LIMITS.characters)),
				disposition: 'UNRESOLVED' as const,
			})),
		];
	}
	const report: LocatedExtraction['report'] = {
		schemaVersion: 1,
		parser: { name: PARSER_NAME, version: PARSER_VERSION },
		inputBytes: source.bytes.byteLength,
		pages: pages.length,
		tables: tables.length,
		cells,
		textCharacters: characters,
		replacementCharacters: replacements,
		truncated: false,
		warnings,
	};
	if ([...flags].some((code) => !warnings.some((warning) => warning.code === code))) return invalid();
	return validateLocatedExtraction(source, { title, pages, tables, flags: [...flags], locations: { pages: pageLocations, tables: tableLocations }, report });
}

function replacementCountTotal(pageTexts: readonly PageText[], tables: readonly Extraction['tables'][number][]): number {
	let total = pageTexts.reduce((sum, page) => sum + countReplacements(page.text), 0);
	for (const table of tables) for (const row of table.rows) for (const cell of row) total += countReplacements(cell);
	return total;
}

/** Parse only verified PDF bytes; no URL, password, OCR service, or external-resource option is supplied. */
export async function parsePdfSource(source: ImportSource, signal?: AbortSignal): Promise<LocatedExtraction> {
	let verified: ImportSource;
	try {
		verified = verifyImportSource(source);
		if (verified.format !== 'PDF' || signal?.aborted) return invalid();
	} catch {
		return invalid();
	}

	let parser: PDFParse | null = null;
	let destroyPromise: Promise<void> | null = null;
	let abortHandler: (() => void) | null = null;
	let rejectAbort: ((error: Error) => void) | null = null;
	let extraction: LocatedExtraction | null = null;
	let failed = false;

	try {
		parser = new PDFParse({
			data: Uint8Array.from(verified.bytes),
			isEvalSupported: false,
			useWorkerFetch: false,
			useWasm: false,
			stopAtErrors: true,
			enableXfa: false,
			disableFontFace: true,
			isOffscreenCanvasSupported: false,
			isImageDecoderSupported: false,
			verbosity: 0,
		});
		const currentParser = parser;
		const destroy = (): Promise<void> => {
			if (destroyPromise === null) destroyPromise = currentParser.destroy();
			return destroyPromise;
		};

		let abortPromise: Promise<never> | null = null;
		if (signal) {
			abortPromise = new Promise<never>((_resolve, reject) => {
				rejectAbort = reject;
			});
			abortHandler = () => {
				void destroy().catch(() => undefined);
				rejectAbort?.(new Error('IMPORT_PARSE_INVALID'));
			};
			signal.addEventListener('abort', abortHandler, { once: true });
		}

		const run = async (): Promise<LocatedExtraction> => {
			const info = await currentParser.getInfo({ parsePageInfo: true });
			if (signal?.aborted || !Number.isInteger(info.total) || info.total < 1 || info.total > IMPORT_LIMITS.pages) return invalid();
			const text = await currentParser.getText(parseParameters);
			if (signal?.aborted || text.total !== info.total || text.pages.length !== info.total) return invalid();
			if (text.pages.some((page, index) => page.num !== index + 1 || typeof page.text !== 'string')) return invalid();
			const pageCharacters = text.pages.reduce((sum, page) => sum + page.text.length, 0);
			if (pageCharacters > IMPORT_LIMITS.characters) return invalid();
			const tableResult = await currentParser.getTable();
			if (signal?.aborted || tableResult.total !== info.total) return invalid();
			const result = buildExtraction(
				verified,
				text.pages,
				tableResult.pages,
				info.pages.map((page) => ({ pageNumber: page.pageNumber, links: page.links })),
				Boolean(info.outline?.some(containsExternalOutline)),
			);
			if (signal?.aborted) return invalid();
			return result;
		};

		const operation = run();
		extraction = abortPromise ? await Promise.race([operation, abortPromise]) : await operation;
	} catch {
		failed = true;
	} finally {
		if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
		if (parser) {
			try {
				await (destroyPromise ??= parser.destroy());
			} catch {
				failed = true;
			}
		}
	}

	if (failed || extraction === null) return invalid();
	return extraction;
}

function containsExternalOutline(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const node = value as { url?: unknown; unsafeUrl?: unknown; items?: unknown };
	if (typeof node.url === 'string' && node.url.length > 0) return true;
	if (typeof node.unsafeUrl === 'string' && node.unsafeUrl.length > 0) return true;
	return Array.isArray(node.items) && node.items.some(containsExternalOutline);
}
