interface PdfTextLine {
	text: string;
	x?: number;
	y?: number;
	size?: number;
}

interface PdfPageFixture {
	lines?: readonly PdfTextLine[];
	tables?: readonly (readonly (readonly string[])[])[];
	scanImage?: boolean;
}

const escapePdfString = (value: string): string =>
	value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

/** Build a deterministic, valid PDF with text and optional ruled tables. */
export function createPdfFixture(pages: readonly PdfPageFixture[], replaceAWithReplacement = false): Uint8Array {
	if (pages.length === 0) throw new Error("fixture requires at least one page");

	const pageObjectIds = pages.map((_, index) => 3 + index * 2);
	const fontObjectId = 3 + pages.length * 2;
	const imageObjectId = pages.some((page) => page.scanImage) ? fontObjectId + 1 : null;
	const replacementMapObjectId = replaceAWithReplacement ? fontObjectId + (imageObjectId === null ? 1 : 2) : null;
	const objects: string[] = [];
	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

	for (const [index, page] of pages.entries()) {
		const pageObjectId = pageObjectIds[index];
		const contentObjectId = pageObjectId + 1;
		const operations: string[] = [];
		for (const line of page.lines ?? []) {
			const x = line.x ?? 72;
			const y = line.y ?? 720 - operations.length * 24;
			const size = line.size ?? 12;
			operations.push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfString(line.text)}) Tj ET`);
		}

		for (const [tableIndex, rows] of (page.tables ?? []).entries()) {
			const left = 72;
			const top = 600 - tableIndex * 180;
			const rowHeight = 24;
			const columnWidth = 120;
			const rowCount = rows.length;
			const columnCount = Math.max(0, ...rows.map((row) => row.length));
			if (rowCount === 0 || columnCount === 0) continue;

			operations.push("q 0.5 w");
			for (let row = 0; row <= rowCount; row++) {
				const y = top - row * rowHeight;
				operations.push(`${left} ${y} m ${left + columnCount * columnWidth} ${y} l S`);
			}
			for (let column = 0; column <= columnCount; column++) {
				const x = left + column * columnWidth;
				operations.push(`${x} ${top} m ${x} ${top - rowCount * rowHeight} l S`);
			}
			operations.push("Q");

			for (const [rowIndex, row] of rows.entries()) {
				for (const [columnIndex, cell] of row.entries()) {
					if (cell.length === 0) continue;
					const x = left + columnIndex * columnWidth + 6;
					const y = top - rowIndex * rowHeight - 16;
					operations.push(`BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfString(cell)}) Tj ET`);
				}
			}
		}

		const xObjectResource = page.scanImage && imageObjectId !== null ? `/XObject << /Im1 ${imageObjectId} 0 R >>` : "";
		if (page.scanImage) operations.unshift("q 612 0 0 792 0 0 cm /Im1 Do Q");
		const stream = operations.join("\n");
		objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> ${xObjectResource} >> /Contents ${contentObjectId} 0 R >>`;
		objects[contentObjectId] = `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}\nendstream`;
	}
	objects[fontObjectId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding${replacementMapObjectId === null ? "" : ` /ToUnicode ${replacementMapObjectId} 0 R`} >>`;
	if (imageObjectId !== null) {
		objects[imageObjectId] = "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream";
	}
	if (replacementMapObjectId !== null) {
		const cmap = [
			"/CIDInit /ProcSet findresource begin",
			"12 dict begin",
			"begincmap",
			"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
			"/CMapName /Fixture-Replacement def",
			"/CMapType 2 def",
			"1 begincodespacerange <00> <FF> endcodespacerange",
			"1 beginbfchar <41> <FFFD> endbfchar",
			"endcmap",
			"CMapName currentdict /CMap defineresource pop",
			"end",
			"end",
		].join("\n");
		objects[replacementMapObjectId] = `<< /Length ${new TextEncoder().encode(cmap).byteLength} >>\nstream\n${cmap}\nendstream`;
	}

	let pdf = "%PDF-1.7\n%YRU-IMP-01B-PDF-test-fixture\n";
	const offsets = [0];
	let byteOffset = new TextEncoder().encode(pdf).byteLength;
	for (let id = 1; id < objects.length; id++) {
		offsets.push(byteOffset);
		const object = `${id} 0 obj\n${objects[id]}\nendobj\n`;
		pdf += object;
		byteOffset += new TextEncoder().encode(object).byteLength;
	}
	const xrefOffset = byteOffset;
	pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return new TextEncoder().encode(pdf);
}

export function createMalformedPdfFixture(): Uint8Array {
	return new TextEncoder().encode("%PDF-1.7\nnot a valid PDF body\n%%EOF\n");
}

export function createScannedPdfFixture(): Uint8Array {
	return createPdfFixture([{ scanImage: true }]);
}

export function createReplacementPdfFixture(): Uint8Array {
	return createPdfFixture([{ lines: [{ text: 'Replacement: A', size: 12 }] }], true);
}

export function createOversizedTextPdfFixture(characters: number): Uint8Array {
	return createPdfFixture([{ lines: [{ text: "x".repeat(characters), size: 0.0001 }] }]);
}
