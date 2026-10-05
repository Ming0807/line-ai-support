"""Private CPU embedding infrastructure. No generation or document publication."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hmac
import math
import os
from pathlib import Path
import threading
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL = "intfloat/multilingual-e5-small"
REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
DIMENSION = 384
MAX_TEXT_BYTES = 6000


def load_service_env():
    """Literal key=value config; no expansion or shell evaluation."""
    path = Path(__file__).with_name(".env")
    allowed = {"EMBEDDING_MODEL", "EMBEDDING_DIMENSION", "EMBEDDING_MODEL_REVISION", "EMBEDDING_MODEL_CACHE_DIR", "EMBEDDING_API_KEY", "EMBEDDING_HOST", "EMBEDDING_PORT"}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, separator, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if not separator or key not in allowed:
                raise ValueError("EMBEDDING_CONFIG_INVALID")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key, value)


@dataclass(frozen=True)
class EmbeddingSettings:
    cache_dir: Path
    model: str = MODEL
    revision: str = REVISION
    dimension: int = DIMENSION
    api_key: str = ""
    host: str = "127.0.0.1"

    def __post_init__(self):
        if self.model != MODEL or self.revision != REVISION or self.dimension != DIMENSION:
            raise ValueError("EMBEDDING_CONFIG_INVALID")
        if self.api_key and (len(self.api_key) < 16 or len(self.api_key) > 512 or any(c.isspace() for c in self.api_key)):
            raise ValueError("EMBEDDING_CONFIG_INVALID")
        if self.host not in ("127.0.0.1", "localhost", "::1") and not self.api_key:
            raise ValueError("EMBEDDING_AUTH_REQUIRED")
        object.__setattr__(self, "cache_dir", Path(self.cache_dir).expanduser().resolve())

    @classmethod
    def from_env(cls):
        load_service_env()
        return cls(cache_dir=Path(os.environ.get("EMBEDDING_MODEL_CACHE_DIR", os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface")))),
                   model=os.environ.get("EMBEDDING_MODEL", MODEL), revision=os.environ.get("EMBEDDING_MODEL_REVISION", REVISION),
                   dimension=int(os.environ.get("EMBEDDING_DIMENSION", str(DIMENSION))), api_key=os.environ.get("EMBEDDING_API_KEY", ""),
                   host=os.environ.get("EMBEDDING_HOST", "127.0.0.1"))


def cached_snapshot(settings):
    root = settings.cache_dir
    snapshot = root / "hub" / "models--intfloat--multilingual-e5-small" / "snapshots" / settings.revision
    required = ["config.json", "modules.json", "model.safetensors", "tokenizer.json", "1_Pooling/config.json"]
    if not snapshot.is_dir() or not snapshot.resolve().is_relative_to(root):
        raise RuntimeError("EMBEDDING_CACHE_MISSING")
    for name in required:
        path = snapshot / name
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise RuntimeError("EMBEDDING_CACHE_MISSING")
    if any(not path.resolve().is_relative_to(root) for path in snapshot.rglob("*")):
        raise RuntimeError("EMBEDDING_CACHE_INVALID")
    return snapshot


def load_model(settings, snapshot):
    os.environ["HF_HOME"] = str(settings.cache_dir)
    os.environ["HF_HUB_CACHE"] = str(settings.cache_dir / "hub")
    os.environ["SENTENCE_TRANSFORMERS_HOME"] = str(settings.cache_dir / "hub")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from sentence_transformers import SentenceTransformer
    import torch
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    return SentenceTransformer(str(snapshot), device="cpu", cache_folder=str(settings.cache_dir / "hub"), local_files_only=True, trust_remote_code=False)


def check_text(value):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ValueError("EMBEDDING_INPUT_INVALID")
    return value


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=MAX_TEXT_BYTES)
    type: Literal["query", "passage"] = "query"
    _text = field_validator("text")(check_text)


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    texts: list[str] = Field(min_length=1, max_length=16)
    type: Literal["passage"] = "passage"

    @field_validator("texts")
    @classmethod
    def text_bounds(cls, values):
        return [check_text(value) for value in values]


def validated_vectors(values, count):
    if not isinstance(values, list) or len(values) != count:
        raise RuntimeError("EMBEDDING_OUTPUT_INVALID")
    for vector in values:
        if len(vector) != DIMENSION or any(not isinstance(x, (float, int)) or isinstance(x, bool) or not math.isfinite(x) for x in vector):
            raise RuntimeError("EMBEDDING_OUTPUT_INVALID")
        if abs(math.sqrt(sum(x*x for x in vector)) - 1) > 0.001:
            raise RuntimeError("EMBEDDING_OUTPUT_INVALID")
    return values


def create_app(settings=None, model_factory=None):
    settings = settings or EmbeddingSettings.from_env()
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(application):
        snapshot = cached_snapshot(settings)
        model = model_factory(snapshot) if model_factory else load_model(settings, snapshot)
        if model.get_sentence_embedding_dimension() != DIMENSION:
            raise RuntimeError("EMBEDDING_MODEL_DIMENSION_INVALID")
        application.state.model = model
        yield
        application.state.model = None

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def authenticate(request: Request):
        if not settings.api_key and (request.client is None or request.client.host not in ("127.0.0.1", "::1")):
            raise HTTPException(status_code=403, detail="EMBEDDING_AUTH_REQUIRED")
        if settings.api_key and not hmac.compare_digest(request.headers.get("authorization", "").encode("utf-8"), ("Bearer " + settings.api_key).encode("utf-8")):
            raise HTTPException(status_code=401, detail="EMBEDDING_UNAUTHENTICATED")

    def encode(texts, kind):
        model = application.state.model
        prefixed = [kind + ": " + text for text in texts]
        if not lock.acquire(blocking=False):
            raise HTTPException(status_code=503, detail="EMBEDDING_BUSY")
        try:
            for text in prefixed:
                if len(model.tokenizer(text, truncation=False, add_special_tokens=True)["input_ids"]) > 512:
                    raise HTTPException(status_code=422, detail="EMBEDDING_INPUT_TOO_LONG")
            return validated_vectors(model.encode(prefixed, normalize_embeddings=True, batch_size=16, show_progress_bar=False).tolist(), len(texts))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="EMBEDDING_UNAVAILABLE") from None
        finally:
            lock.release()

    @application.get("/health", dependencies=[Depends(authenticate)])
    def health():
        return {"status": "ok", "model": settings.model, "revision": settings.revision, "dimension": DIMENSION}

    @application.post("/embed", dependencies=[Depends(authenticate)])
    def embed(request: EmbedRequest):
        return {"model": settings.model, "revision": settings.revision, "dimension": DIMENSION, "embedding": encode([request.text], request.type)[0]}

    @application.post("/embed/batch", dependencies=[Depends(authenticate)])
    def embed_batch(request: BatchRequest):
        return {"model": settings.model, "revision": settings.revision, "dimension": DIMENSION, "embeddings": encode(request.texts, request.type)}

    return application


app = create_app()
