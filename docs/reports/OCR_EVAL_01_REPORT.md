# OCR-EVAL-01 — OpenThai2.0-OCR-Text on the public YRU corpus

16 November 2026, Root, on the owner's request ("Test it first"). This is evaluation evidence only: no product code, import behaviour, provider or database changed.

## What was tested

- Model: `iapp/OpenThai2.0-OCR-Text`, revision `40e8e9ff752b65153b1a71d521ec9390882afd7e`, Apache-2.0. Only `det.onnx`, `rec.onnx`, `rec_dict.txt`, `config.json`, `det.yml`, `runtime/*.py`, `NOTICE`, `README.md` were downloaded (about 4 MB). The PyTorch pickle `pytorch/rec_weights.pt` was not downloaded. All model and runtime files match the repository `SHA256SUMS`; only `README.md` differs from its listed hash (documentation). The runtime code was read before use: it imports only numpy/OpenCV/pyclipper/onnxruntime and makes no network or subprocess calls.
- Location: `D:/AI/Models/openthai2-ocr-text/<revision>/` (outside the repository). Isolated venv and scripts: `D:/codex-cache/ocr-eval/` (`scripts/inventory.py`, `scripts/bench.py`, `scripts/inspect.py`; Python 3.13, onnxruntime CPU, 1 thread, `python -I`).
- Corpus: the public documents committed under `documents/yru/` (165 PDFs). Pages were rendered with pdfium at 200 dpi.

## Corpus finding

| Pages | Count |
|---|---|
| Total pages | 1,526 |
| **No text layer (scanned, < 20 characters)** | **1,017 (66.6%)** |
| Clean Thai text layer (≥ 200 chars, ≥ 50% Thai, no replacement/private-use characters) | 334 |
| Text layer with replacement/private-use characters | 48 |

Two thirds of the corpus currently becomes `OCR_REQUIRED` and must be typed by hand before publication.

## Accuracy against text layers (40 pages, at most 2 per file, seed 20261116)

Ground truth is the PDF text layer of clean born-digital pages, compared after the model's own `canonical` normalisation, Thai→Arabic digits and whitespace removal. Text layers are an imperfect reference: table cell order differs from visual reading order and 7 of 40 pages had OCR output more than 15% longer or shorter than the text layer (incomplete or garbled layers), so the order-sensitive score is pessimistic.

| Variant | Order-sensitive accuracy (median) | Order-insensitive 3-gram F1 | Numbers found (exact token) | Seconds/page |
|---|---|---|---|---|
| Rendered 200 dpi | 75.2 | 88.1 | 1,233/1,290 (95.6%) | 0.85 |
| Simulated scan: 150 dpi, ±1.2° rotation, blur, noise, JPEG q60 | 75.2 | 87.9 | 1,231/1,290 (95.4%) | 0.77 |

On the 33 length-consistent pages, 87% of reference characters align in order, and isolated 1–2 character substitutions occur about 8 times per 1,000 characters. The most frequent pairs are า↔ำ (likely sara-am encoding in text layers) and Thai letter confusions; digit confusions seen: `0→O` (5), `1→5` (4). By category (rendered): guides F1 91.1 / numbers 93.8%; calendars (tables) 94.9 / 97.2%; fee table 97.5 / 100%; **forms 72.1 / 80.6%** (dotted fill-in lines, boxes and labels read poorly). The simulated scan degradation made no measurable difference.

## Real scanned pages (30 pages, 1 per file)

0.92 s/page on this laptop CPU (1 thread; the model card's 0.39 s is on a Xeon with AMX), 43.5 lines/page, mean line confidence 0.969, 28 of 1,305 lines (2.1%) below 0.9, no empty page. Two pages were checked by eye against the rendered image:

- `02-student-affairs/dormitory-fees-and-fines-2568.pdf` p1 (announcement with Thai-digit amounts): every amount in clauses 4–6 was read correctly (๖,๐๐๐ / ๑,๐๐๐ / ๕ / ๒๐ / ๒,๐๐๐ / ๑๐ / ๑,๐๐๐ / ๑๐๐ / ๓๐๐ / ๕๐๐ / ๑๐๐ / ๕๐๐ / ๓). One short final line `๑๐๐ บาท` was read as `๑๐O Uาท`; it was the **lowest-confidence line on the page (0.853; page median 0.969)**. One word error: แตก → แติก.
- `01-academic/transfer-tables/…อิสลามศึกษา…2568` p1 (ruled table): all 18 course codes and credit values correct and rows in order; column boundaries are lost (cells joined by spaces); a few Thai names drop or alter one mark.

## Conclusions

1. Useful as a **draft** for `OCR_REQUIRED` pages of printed announcements, regulations and simple tables; it would replace most manual typing of 1,017 pages (about 15 minutes of CPU for the whole set at 0.9 s/page).
2. Not acceptable without review: numbers are about 95–96% exact, short lines and forms are weak, table structure is lost. Human review before publication (existing rule) remains mandatory; line confidence < 0.9 is a good highlight signal (it caught the only numeric error seen by eye) but not a guarantee.
3. Forms and handwriting should stay manual or use another method.
4. E5 embedding is unaffected: OCR produces text that still needs chunking and embedding.

## Not covered

Ground truth from real human transcription of scanned pages (only 2 pages checked by eye), handwritten or photographed documents, Student chat images, speed on the deployment server, and integration (no service, API or UI exists). The proposed integration is OCR-IMP-01 (draft text for OCR_REQUIRED pages behind review, local loopback service like `services/embedding`).
