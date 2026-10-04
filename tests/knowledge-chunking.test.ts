import { describe, expect, it } from 'vitest';
import { chunkPages } from '../lib/knowledge/chunking';

describe('chunkPages', () => {
  it('keeps a short page as one source-attributed chunk', () => {
    expect(
      chunkPages([{ pageNumber: 4, text: 'Transfer applications close on 15 June.', requiresReview: false }]),
    ).toEqual([
      {
        index: 0,
        pageNumber: 4,
        sectionTitle: null,
        content: 'Transfer applications close on 15 June.',
        requiresReview: false,
      },
    ]);
  });

  it('retains Thai and Markdown headings as section provenance without changing date or money text', () => {
    const chunks = chunkPages([
      {
        pageNumber: 1,
        text: '# การสมัครเรียน\n\nข้อ ๒ เอกสารที่ใช้\n\nกำหนดวันที่ 15/06/2569 และค่าธรรมเนียม 1,250 บาท',
        requiresReview: false,
      },
    ]);

    expect(chunks.map(({ content, sectionTitle }) => [content, sectionTitle])).toEqual([
      ['# การสมัครเรียน', 'การสมัครเรียน'],
      ['ข้อ ๒ เอกสารที่ใช้', 'ข้อ ๒ เอกสารที่ใช้'],
      ['กำหนดวันที่ 15/06/2569 และค่าธรรมเนียม 1,250 บาท', 'ข้อ ๒ เอกสารที่ใช้'],
    ]);
  });

  it('preserves page boundaries, unknown pages, and review flags', () => {
    expect(chunkPages([
      { pageNumber: null, text: 'No extracted page number.', requiresReview: true },
      { pageNumber: 2, text: 'Known page.', requiresReview: false },
    ])).toMatchObject([
      { index: 0, pageNumber: null, requiresReview: true },
      { index: 1, pageNumber: 2, requiresReview: false },
    ]);
  });

  it('carries section provenance across continuation pages until a new heading appears', () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: '## การโอนย้าย\n\nผู้สมัครยื่นเอกสารได้', requiresReview: false },
      { pageNumber: 2, text: 'กำหนดรับเอกสารถึงวันที่ 15 มิถุนายน', requiresReview: false },
      { pageNumber: 3, text: 'บทที่ 2 การสมัคร\n\nผู้สมัครใหม่ต้องลงทะเบียน', requiresReview: false },
      { pageNumber: 4, text: 'ตรวจสอบผลได้ภายหลัง', requiresReview: false },
    ]);

    expect(chunks.find(({ pageNumber }) => pageNumber === 2)).toMatchObject({
      pageNumber: 2,
      sectionTitle: 'การโอนย้าย',
      content: 'กำหนดรับเอกสารถึงวันที่ 15 มิถุนายน',
    });
    expect(chunks.find(({ pageNumber }) => pageNumber === 4)).toMatchObject({
      pageNumber: 4,
      sectionTitle: 'บทที่ 2 การสมัคร',
      content: 'ตรวจสอบผลได้ภายหลัง',
    });
  });

  it('keeps Markdown table rows together and within the configured bound', () => {
    const chunks = chunkPages([{
      pageNumber: 3,
      text: '| รายการ | วัน |\n|---|---|\n| รับสมัคร | 1 มิ.ย. |\n| ประกาศผล | 5 มิ.ย. |',
      requiresReview: false,
    }], { maxCharacters: 256 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('| รายการ | วัน |\n|---|---|\n| รับสมัคร | 1 มิ.ย. |\n| ประกาศผล | 5 มิ.ย. |');
    expect(Array.from(chunks[0].content).length).toBeLessThanOrEqual(256);
    expect(chunks[0].requiresReview).toBe(false);
  });

  it('splits long Unicode paragraphs on codepoint boundaries and overlaps only within a page', () => {
    const text = 'ก😀'.repeat(150);
    const chunks = chunkPages([
      { pageNumber: 1, text, requiresReview: false },
      { pageNumber: 2, text: 'ข😀'.repeat(150), requiresReview: false },
    ], { maxCharacters: 256, overlapCharacters: 20 });

    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => Array.from(chunk.content).length <= 256)).toBe(true);
    expect(Array.from(chunks[0].content).slice(-20).join('')).toBe(Array.from(chunks[1].content).slice(0, 20).join(''));
    expect(chunks[1].pageNumber).toBe(1);
    expect(chunks[2].pageNumber).toBe(2);
    expect(Array.from(chunks[1].content).slice(-20).join('')).not.toBe(Array.from(chunks[2].content).slice(0, 20).join(''));
  });

  it('never splits Thai marks, combining accents, or joined emoji graphemes', () => {
    const cases = [
      { prefix: 'x'.repeat(255), cluster: 'ก\u0E48', suffix: 'y'.repeat(100) },
      { prefix: 'x'.repeat(255), cluster: 'e\u0301', suffix: 'y'.repeat(100) },
      { prefix: 'x'.repeat(254), cluster: '👩🏽‍💻', suffix: 'y'.repeat(100) },
    ];

    for (const { prefix, cluster, suffix } of cases) {
      const chunks = chunkPages([{
        pageNumber: 1,
        text: `${prefix}${cluster}${suffix}`,
        requiresReview: false,
      }], { maxCharacters: 256, overlapCharacters: 0 });
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const graphemes = chunks.flatMap((chunk) => Array.from(segmenter.segment(chunk.content), (item) => item.segment));

      expect(chunks.every((chunk) => Array.from(chunk.content).length <= 256)).toBe(true);
      expect(graphemes.join('')).toBe(`${prefix}${cluster}${suffix}`);
      expect(graphemes).toContain(cluster);
    }
  });

  it('marks a table chunk for review when one row must be split', () => {
    const chunks = chunkPages([{
      pageNumber: 8,
      text: `|${'แ'.repeat(300)}|`,
      requiresReview: false,
    }], { maxCharacters: 256 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.requiresReview)).toBe(true);
    expect(chunks.every((chunk) => Array.from(chunk.content).length <= 256)).toBe(true);
  });

  it('rejects a single grapheme that cannot fit within the configured bound', () => {
    const tooLongGrapheme = `${'👩‍'.repeat(130)}👩`;
    expect(() => chunkPages([{
      pageNumber: 1,
      text: tooLongGrapheme,
      requiresReview: false,
    }], { maxCharacters: 256, overlapCharacters: 0 })).toThrowError('CHUNK_LIMIT_EXCEEDED');
  });

  it('skips pages containing only whitespace', () => {
    expect(chunkPages([{ pageNumber: 1, text: ' \n\t ', requiresReview: false }])).toEqual([]);
  });

  it('rejects malformed input and invalid options with a fixed error code', () => {
    for (const run of [
      () => chunkPages([{ pageNumber: 0, text: 'x', requiresReview: false }]),
      () => chunkPages([{ pageNumber: 1, text: 123, requiresReview: false } as never]),
      () => chunkPages([], { maxCharacters: 255 }),
      () => chunkPages([], { maxCharacters: 6001 }),
      () => chunkPages([], { maxCharacters: null as never }),
      () => chunkPages([], { overlapCharacters: 201 }),
      () => chunkPages([], { maxChunks: 0 }),
    ]) {
      expect(run).toThrowError('CHUNK_INPUT_INVALID');
    }
  });

  it('rejects page, character, and output-count limits with a fixed error code', () => {
    expect(() => chunkPages(Array.from({ length: 1001 }, () => ({
      pageNumber: null,
      text: '',
      requiresReview: false,
    })))).toThrowError('CHUNK_LIMIT_EXCEEDED');

    expect(() => chunkPages([{ pageNumber: null, text: 'x'.repeat(5_000_001), requiresReview: false }]))
      .toThrowError('CHUNK_LIMIT_EXCEEDED');
    expect(() => chunkPages([{ pageNumber: 1, text: 'x'.repeat(600), requiresReview: false }], {
      maxCharacters: 256,
      overlapCharacters: 0,
      maxChunks: 1,
    })).toThrowError('CHUNK_LIMIT_EXCEEDED');
  });
});
