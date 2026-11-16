"""Supported entrypoint: validate binding/auth config before opening a listener."""
import os

import uvicorn

from app import OcrSettings

settings = OcrSettings.from_env()
port = int(os.environ.get("OCR_PORT", "8010"))
if not 1 <= port <= 65535:
    raise ValueError("OCR_CONFIG_INVALID")
uvicorn.run("app:create_app", factory=True, host=settings.host, port=port, access_log=False, workers=1)
