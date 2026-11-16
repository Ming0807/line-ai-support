# OCR service (OCR-IMP-01)

Private CPU OCR drafts for scanned PDF pages in the knowledge import review. Model: `iapp/OpenThai2.0-OCR-Text`, revision `40e8e9ff752b65153b1a71d521ec9390882afd7e` (Apache-2.0). Output is a draft for a human reviewer, never publishable text by itself. See [DEC-204](../../docs/decisions/DECISION_LOG.md) and the [evaluation](../../docs/reports/OCR_EVAL_01_REPORT.md).

## Setup (once)

1. Put the model files of the pinned revision in a folder outside the repository (no PyTorch pickle needed): `config.json det.onnx det.yml rec.onnx rec_dict.txt runtime/__init__.py runtime/line_engine.py runtime/thai_norm.py`. The service refuses to start if any file is missing or its SHA-256 differs from `PINNED_SHA256` in `app.py`. It never downloads anything.
2. `python -m venv .venv` then `.venv/Scripts/python -m pip install -r requirements.txt` (add `requirements-test.txt` for tests).
3. Copy `.env.example` to `.env` and set `OCR_MODEL_DIR`.

## Run

```
services/ocr/.venv/Scripts/python services/ocr/run.py
```

Binds `127.0.0.1:8010` by default. A non-loopback host requires `OCR_API_KEY`. In the root `.env` set `KNOWLEDGE_IMPORT_OCR_ENABLED=true` and `OCR_API_URL=http://127.0.0.1:8010` to show the OCR buttons in the import review page.

## API

- `GET /health` → `{model, revision, healthy}` (no paths)
- `POST /ocr/pdf`, body = raw PDF (`application/pdf`, ≤ 20 MiB), header `X-Yru-Pages: 1,3,4` (1-based, ascending, ≤ 20 pages), optional `Authorization: Bearer <key>` → `{model, revision, pages:[{page, text, lines:[{text, confidence}]}]}`. Pages are rendered at 200 dpi and read one at a time. Errors are fixed codes (`OCR_INPUT_INVALID`, `OCR_INPUT_TOO_LARGE`, `OCR_UNAUTHORIZED`, `OCR_UNAVAILABLE`); responses are `no-store`; document text is never logged.

Tests: `.venv/Scripts/python -m pytest -q` (fake engine, no model files needed).
