"""Supported entrypoint: validate binding/auth config before opening a listener."""
from app import EmbeddingSettings
import os
import uvicorn

settings = EmbeddingSettings.from_env()
port = int(os.environ.get("EMBEDDING_PORT", "8000"))
if not 1 <= port <= 65535:
    raise ValueError("EMBEDDING_CONFIG_INVALID")
uvicorn.run("app:app", host=settings.host, port=port, access_log=False)
