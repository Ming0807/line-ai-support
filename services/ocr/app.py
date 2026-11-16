"""OCR-IMP-01: private CPU OCR drafts for scanned import pages (iapp/OpenThai2.0-OCR-Text).

Output is a draft for human review only. No model download, no publication, no logging of document text.
"""
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hashlib
import hmac
import os
from pathlib import Path
import re
import sys
import threading

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

MODEL = "iapp/OpenThai2.0-OCR-Text"
REVISION = "40e8e9ff752b65153b1a71d521ec9390882afd7e"
# From the pinned revision's SHA256SUMS (pytorch/rec_weights.pt is intentionally not used).
PINNED_SHA256 = {
    "config.json": "11599c0dae206381cb8ea11c1b7ce130b2e7971c19219f409785ee8c02ab5d94",
    "det.onnx": "193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8",
    "det.yml": "3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593",
    "rec.onnx": "82ec89533346faadcb30df96703dad2dd7521de65709e60d83fd9745b8968124",
    "rec_dict.txt": "259ef2636cec0eeae225ae9fd9a63fa9305285650c22d7ec34fe8a82b24c2f1a",
    "runtime/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "runtime/line_engine.py": "5d5d672658d2a82ca6b32e230bb551eefe5d1e4efa46ff21908bfcfd75e5495c",
    "runtime/thai_norm.py": "53a03ac139fb0de3e7aec0f5b8ab69b0b519fb5e636f7c1de09cb357b023344a",
}
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PAGES = 20
MAX_PAGE_NUMBER = 1000
RENDER_DPI = 200
MAX_RENDER_SIDE = 4200
MAX_LINES = 500
MAX_LINE_CHARS = 2000
MAX_TEXT_CHARS = 200000
PAGES_PATTERN = re.compile(r"^[1-9][0-9]{0,3}(,[1-9][0-9]{0,3}){0,19}$")


def load_service_env():
    """Literal key=value config; no expansion or shell evaluation."""
    path = Path(__file__).with_name(".env")
    allowed = {"OCR_MODEL_DIR", "OCR_API_KEY", "OCR_HOST", "OCR_PORT"}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, separator, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if not separator or key not in allowed:
                raise ValueError("OCR_CONFIG_INVALID")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key, value)


@dataclass(frozen=True)
class OcrSettings:
    model_dir: Path
    api_key: str = ""
    host: str = "127.0.0.1"
    verify_hashes: bool = True

    def __post_init__(self):
        if self.api_key and (len(self.api_key) < 16 or len(self.api_key) > 512 or any(c.isspace() for c in self.api_key)):
            raise ValueError("OCR_CONFIG_INVALID")
        if self.host not in ("127.0.0.1", "localhost", "::1") and not self.api_key:
            raise ValueError("OCR_AUTH_REQUIRED")
        object.__setattr__(self, "model_dir", Path(self.model_dir).expanduser().resolve())

    @classmethod
    def from_env(cls):
        load_service_env()
        model_dir = os.environ.get("OCR_MODEL_DIR", "")
        if not model_dir:
            raise ValueError("OCR_CONFIG_INVALID")
        return cls(model_dir=Path(model_dir), api_key=os.environ.get("OCR_API_KEY", ""), host=os.environ.get("OCR_HOST", "127.0.0.1"))


def verify_model_dir(model_dir):
    root = Path(model_dir)
    if not root.is_dir():
        raise RuntimeError("OCR_MODEL_MISSING")
    for name, expected in PINNED_SHA256.items():
        path = root / name
        if not path.is_file():
            raise RuntimeError("OCR_MODEL_MISSING")
        if not path.resolve().is_relative_to(root.resolve()):
            raise RuntimeError("OCR_MODEL_INVALID")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError("OCR_MODEL_INVALID")
    return root


def load_engine(model_dir):
    """Imports the hash-verified upstream runtime from the pinned model directory."""
    sys.path.insert(0, str(model_dir))
    from runtime.line_engine import LineOCR  # noqa: PLC0415
    return LineOCR(str(model_dir), threads=1)


def parse_pages(value, page_count):
    if not isinstance(value, str) or not PAGES_PATTERN.fullmatch(value):
        raise HTTPException(400, "OCR_INPUT_INVALID")
    pages = [int(part) for part in value.split(",")]
    if any(b <= a for a, b in zip(pages, pages[1:])) or len(pages) > MAX_PAGES or pages[-1] > min(page_count, MAX_PAGE_NUMBER):
        raise HTTPException(400, "OCR_INPUT_INVALID")
    return pages


def render_page(document, number):
    import numpy as np
    page = document[number - 1]
    width, height = page.get_size()
    scale = min(RENDER_DPI / 72, MAX_RENDER_SIDE / max(width, height, 1))
    array = page.render(scale=scale).to_numpy()
    return np.ascontiguousarray(array[:, :, :3][:, :, ::-1])  # RGB(A) -> BGR


def bounded_result(number, result):
    lines = []
    for line in (result.get("lines") or [])[:MAX_LINES]:
        text = str(line.get("text", ""))[:MAX_LINE_CHARS]
        confidence = float(line.get("confidence", 0))
        if not 0 <= confidence <= 1:
            raise RuntimeError("OCR_OUTPUT_INVALID")
        lines.append({"text": text, "confidence": round(confidence, 4)})
    # The runtime's own text keeps same-row segments together in reading order.
    text = result.get("text")
    if not isinstance(text, str):
        raise RuntimeError("OCR_OUTPUT_INVALID")
    return {"page": number, "text": text[:MAX_TEXT_CHARS], "lines": lines}


class PrivateResponseMiddleware:
    """Never cache OCR results or errors."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = [(n, v) for n, v in message.get("headers", []) if n.lower() != b"cache-control"]
                message = {**message, "headers": [*headers, (b"cache-control", b"no-store")]}
            await send(message)
        return await self.app(scope, receive, private_send)


def create_app(settings=None, engine_factory=None):
    settings = settings or OcrSettings.from_env()
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(application):
        if settings.verify_hashes:
            verify_model_dir(settings.model_dir)
        application.state.engine = (engine_factory or load_engine)(settings.model_dir)
        yield
        application.state.engine = None

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    application.add_middleware(PrivateResponseMiddleware)

    @application.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"detail": error.detail if isinstance(error.detail, str) and error.detail.startswith("OCR_") else "OCR_INPUT_INVALID"},
                            status_code=error.status_code)

    def authorize(request):
        if not settings.api_key:
            return
        header = request.headers.get("authorization", "")
        expected = f"Bearer {settings.api_key}"
        if not hmac.compare_digest(header.encode(), expected.encode()):
            raise HTTPException(401, "OCR_UNAUTHORIZED")

    @application.get("/health")
    def health():
        return {"model": MODEL, "revision": REVISION, "healthy": application.state.engine is not None}

    @application.post("/ocr/pdf")
    async def ocr_pdf(request: Request):
        authorize(request)
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/pdf":
            raise HTTPException(415, "OCR_INPUT_INVALID")
        lengths = request.headers.getlist("content-length")
        if len(lengths) > 1 or any(not v.isdigit() or int(v) > MAX_PDF_BYTES for v in lengths):
            raise HTTPException(413, "OCR_INPUT_TOO_LARGE")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_PDF_BYTES:
                raise HTTPException(413, "OCR_INPUT_TOO_LARGE")
        if not body.startswith(b"%PDF-"):
            raise HTTPException(400, "OCR_INPUT_INVALID")
        pages_header = request.headers.get("x-yru-pages", "")

        def work():
            import pypdfium2 as pdfium
            try:
                document = pdfium.PdfDocument(bytes(body))
            except Exception:  # malformed or password-protected
                raise HTTPException(400, "OCR_INPUT_INVALID") from None
            try:
                pages = parse_pages(pages_header, len(document))
                with lock:  # one page at a time keeps memory bounded
                    out = []
                    for number in pages:
                        try:
                            out.append(bounded_result(number, application.state.engine.read(render_page(document, number))))
                        except HTTPException:
                            raise
                        except Exception:
                            raise HTTPException(503, "OCR_UNAVAILABLE") from None
                    return out
            finally:
                document.close()

        pages = await run_in_threadpool(work)
        return {"model": MODEL, "revision": REVISION, "pages": pages}

    return application

