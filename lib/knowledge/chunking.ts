import type { ChunkDraft, ChunkOptions, ExtractedPage } from './types';

const DEFAULT_MAX_CHARACTERS = 1800;
const DEFAULT_OVERLAP_CHARACTERS = 120;
const DEFAULT_MAX_CHUNKS = 2000;
const MAX_PAGES = 1000;
const MAX_INPUT_CHARACTERS = 5_000_000;

type Block = { kind: 'heading' | 'paragraph' | 'table'; content: string };

function invalidInput(): never {
  throw new Error('CHUNK_INPUT_INVALID');
}

function limitExceeded(): never {
  throw new Error('CHUNK_LIMIT_EXCEEDED');
}

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s+\S/u.test(line) ||
    /^\s*(?:ข้อ(?:ที่)?\s*[0-9๐-๙]+|บทที่\s*[0-9๐-๙]+|หมวด(?:\s|ที่|[0-9๐-๙]))/u.test(line);
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/u);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', content: paragraph.join('\n').trim() });
    paragraph = [];
  };
  const flushTable = () => {
    if (table.length) blocks.push({ kind: 'table', content: table.join('\n').trim() });
    table = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushTable();
      continue;
    }
    if (isHeading(line)) {
      flushParagraph();
      flushTable();
      blocks.push({ kind: 'heading', content: line.trim() });
      continue;
    }
    if (isTableRow(line)) {
      flushParagraph();
      table.push(line.trim());
      continue;
    }
    flushTable();
    paragraph.push(line);
  }
  flushParagraph();
  flushTable();
  return blocks.filter((block) => block.content.length > 0);
}

function getHeadingTitle(content: string): string {
  const title = content.replace(/^\s*#{1,6}\s*/u, '').trim();
  return Array.from(title).slice(0, 180).join('') || content.slice(0, 180);
}

function splitGraphemes(content: string, maxCharacters: number, overlapCharacters: number): string[] {
  const clusters = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content),
    ({ segment }) => segment,
  );
  const lengths = clusters.map((cluster) => Array.from(cluster).length);
  if (lengths.some((length) => length > maxCharacters)) limitExceeded();
  if (lengths.reduce((sum, length) => sum + length, 0) <= maxCharacters) return [content];

  const prefixLengths = [0];
  for (const length of lengths) prefixLengths.push(prefixLengths[prefixLengths.length - 1] + length);
  const chunks: string[] = [];
  let start = 0;
  while (start < clusters.length) {
    let end = start;
    let characters = 0;
    while (end < clusters.length && characters + lengths[end] <= maxCharacters) {
      characters += lengths[end];
      end += 1;
    }
    if (end === clusters.length) {
      chunks.push(clusters.slice(start, end).join(''));
      break;
    }

    chunks.push(clusters.slice(start, end).join(''));
    const overlapStart = prefixLengths[end] - overlapCharacters;
    let nextStart = start + 1;
    while (nextStart < end && prefixLengths[nextStart] < overlapStart) nextStart += 1;
    start = nextStart;
  }
  return chunks;
}

export function chunkPages(pages: ExtractedPage[], options: ChunkOptions = {}): ChunkDraft[] {
  if (!Array.isArray(pages) || pages.length > MAX_PAGES) {
    if (Array.isArray(pages) && pages.length > MAX_PAGES) limitExceeded();
    invalidInput();
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalidInput();

  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const overlapCharacters = options.overlapCharacters ?? DEFAULT_OVERLAP_CHARACTERS;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  if (
    (options.maxCharacters !== undefined && typeof options.maxCharacters !== 'number') ||
    (options.overlapCharacters !== undefined && typeof options.overlapCharacters !== 'number') ||
    (options.maxChunks !== undefined && typeof options.maxChunks !== 'number') ||
    !Number.isInteger(maxCharacters) || maxCharacters < 256 || maxCharacters > 6000 ||
    !Number.isInteger(overlapCharacters) || overlapCharacters < 0 || overlapCharacters > Math.min(200, maxCharacters - 1) ||
    !Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 2000
  ) invalidInput();

  let inputCharacters = 0;
  for (const page of pages) {
    if (!page || typeof page !== 'object' ||
      !(page.pageNumber === null || (Number.isInteger(page.pageNumber) && page.pageNumber > 0)) ||
      typeof page.text !== 'string' || typeof page.requiresReview !== 'boolean') invalidInput();
    inputCharacters += Array.from(page.text).length;
    if (inputCharacters > MAX_INPUT_CHARACTERS) limitExceeded();
  }

  const chunks: ChunkDraft[] = [];
  const append = (pageNumber: number | null, sectionTitle: string | null, content: string, requiresReview: boolean) => {
    if (!content) return;
    if (chunks.length >= maxChunks) limitExceeded();
    chunks.push({ index: chunks.length, pageNumber, sectionTitle, content, requiresReview });
  };

  let observedSectionTitle: string | null = null;
  for (const page of pages) {
    if (!page.text.trim()) continue;
    let pendingParagraphs: string[] = [];

    const flushParagraphs = () => {
      if (!pendingParagraphs.length) return;
      const content = pendingParagraphs.join('\n\n');
      for (const piece of splitGraphemes(content, maxCharacters, overlapCharacters)) {
        append(page.pageNumber, observedSectionTitle, piece, page.requiresReview);
      }
      pendingParagraphs = [];
    };

    for (const block of parseBlocks(page.text)) {
      if (block.kind === 'heading') {
        flushParagraphs();
        observedSectionTitle = getHeadingTitle(block.content);
        for (const piece of splitGraphemes(block.content, maxCharacters, overlapCharacters)) {
          append(page.pageNumber, observedSectionTitle, piece, page.requiresReview);
        }
        continue;
      }

      if (block.kind === 'table') {
        flushParagraphs();
        let tableChunk = '';
        for (const row of block.content.split('\n')) {
          if (Array.from(row).length > maxCharacters) {
            if (tableChunk) append(page.pageNumber, observedSectionTitle, tableChunk, page.requiresReview);
            tableChunk = '';
            for (const piece of splitGraphemes(row, maxCharacters, 0)) {
              append(page.pageNumber, observedSectionTitle, piece, true);
            }
            continue;
          }
          const combined = tableChunk ? `${tableChunk}\n${row}` : row;
          if (Array.from(combined).length > maxCharacters) {
            append(page.pageNumber, observedSectionTitle, tableChunk, page.requiresReview);
            tableChunk = row;
          } else {
            tableChunk = combined;
          }
        }
        if (tableChunk) append(page.pageNumber, observedSectionTitle, tableChunk, page.requiresReview);
        continue;
      }

      const combined = pendingParagraphs.length === 0
        ? block.content
        : `${pendingParagraphs.join('\n\n')}\n\n${block.content}`;
      if (Array.from(combined).length > maxCharacters) {
        flushParagraphs();
        if (Array.from(block.content).length > maxCharacters) {
          for (const piece of splitGraphemes(block.content, maxCharacters, overlapCharacters)) {
            append(page.pageNumber, observedSectionTitle, piece, page.requiresReview);
          }
        } else {
          pendingParagraphs.push(block.content);
        }
      } else {
        pendingParagraphs.push(block.content);
      }
    }
    flushParagraphs();
  }

  return chunks;
}
