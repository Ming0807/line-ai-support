"""OCR-IMP-01 service tests with a fake engine; no model files are needed."""
import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as service

KEY = "k" * 32


def tiny_pdf(pages=2):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(200, 200)
    import io
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


class FakeEngine:
    def __init__(self):
        self.calls = 0

    def read(self, image):
        self.calls += 1
        return {"text": "ค่าบำรุง ๖,๐๐๐ บาท\n๑๐O Uาท", "lines": [
            {"text": "ค่าบำรุง ๖,๐๐๐ บาท", "confidence": 0.95, "row": 0, "box": [[0, 0]]},
            {"text": "๑๐O Uาท", "confidence": 0.853, "row": 1, "box": [[0, 0]]}]}


def make_client(tmp_path, key="", engine=None):
    settings = service.OcrSettings(model_dir=tmp_path, api_key=key, verify_hashes=False)
    fake = engine or FakeEngine()
    return TestClient(service.create_app(settings, engine_factory=lambda _dir: fake)), fake


def test_health_reports_pinned_model_without_paths(tmp_path):
    client, _ = make_client(tmp_path)
    with client:
        body = client.get("/health").json()
    assert body == {"model": service.MODEL, "revision": service.REVISION, "healthy": True}
    assert str(tmp_path) not in str(body)


def test_ocr_pdf_pages_returns_text_and_line_confidence(tmp_path):
    client, fake = make_client(tmp_path)
    with client:
        response = client.post("/ocr/pdf", content=tiny_pdf(3), headers={"content-type": "application/pdf", "x-yru-pages": "1,3"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["model"] == service.MODEL and body["revision"] == service.REVISION
    assert [page["page"] for page in body["pages"]] == [1, 3]
    assert body["pages"][0]["lines"][1] == {"text": "๑๐O Uาท", "confidence": 0.853}
    assert fake.calls == 2


@pytest.mark.parametrize("pages", ["", "0", "2,1", "1,1", "a", "1;2", ",".join(str(i) for i in range(1, 22)), "4"])
def test_rejects_invalid_or_out_of_range_page_lists(tmp_path, pages):
    client, fake = make_client(tmp_path)
    with client:
        response = client.post("/ocr/pdf", content=tiny_pdf(3), headers={"content-type": "application/pdf", "x-yru-pages": pages})
    assert response.status_code in (400, 422)
    assert fake.calls == 0


def test_rejects_non_pdf_wrong_type_and_oversized_bodies(tmp_path):
    client, fake = make_client(tmp_path)
    with client:
        assert client.post("/ocr/pdf", content=b"not a pdf", headers={"content-type": "application/pdf", "x-yru-pages": "1"}).status_code == 400
        assert client.post("/ocr/pdf", content=tiny_pdf(1), headers={"content-type": "text/plain", "x-yru-pages": "1"}).status_code == 415
        big = b"%PDF-" + b"0" * (service.MAX_PDF_BYTES + 1)
        assert client.post("/ocr/pdf", content=big, headers={"content-type": "application/pdf", "x-yru-pages": "1"}).status_code == 413
    assert fake.calls == 0


def test_requires_bearer_key_when_configured(tmp_path):
    client, fake = make_client(tmp_path, key=KEY)
    with client:
        headers = {"content-type": "application/pdf", "x-yru-pages": "1"}
        assert client.post("/ocr/pdf", content=tiny_pdf(1), headers=headers).status_code == 401
        assert client.post("/ocr/pdf", content=tiny_pdf(1), headers={**headers, "authorization": "Bearer wrong"}).status_code == 401
        assert client.post("/ocr/pdf", content=tiny_pdf(1), headers={**headers, "authorization": f"Bearer {KEY}"}).status_code == 200


def test_settings_require_a_key_off_loopback_and_reject_bad_keys(tmp_path):
    with pytest.raises(ValueError):
        service.OcrSettings(model_dir=tmp_path, host="0.0.0.0")
    with pytest.raises(ValueError):
        service.OcrSettings(model_dir=tmp_path, api_key="short")
    service.OcrSettings(model_dir=tmp_path, host="0.0.0.0", api_key=KEY)


def test_model_files_must_match_pinned_hashes(tmp_path):
    for name in service.PINNED_SHA256:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"tampered")
    with pytest.raises(RuntimeError, match="OCR_MODEL_INVALID"):
        service.verify_model_dir(tmp_path)
    with pytest.raises(RuntimeError, match="OCR_MODEL_MISSING"):
        service.verify_model_dir(tmp_path / "missing")


def test_engine_failure_returns_fixed_code_without_details(tmp_path):
    class Broken(FakeEngine):
        def read(self, image):
            raise RuntimeError("secret path D:/AI/Models")
    client, _ = make_client(tmp_path, engine=Broken())
    with client:
        response = client.post("/ocr/pdf", content=tiny_pdf(1), headers={"content-type": "application/pdf", "x-yru-pages": "1"})
    assert response.status_code == 503
    assert response.json() == {"detail": "OCR_UNAVAILABLE"}


def test_page_text_keeps_runtime_row_order_not_one_line_per_segment(tmp_path):
    class RowEngine(FakeEngine):
        def read(self, image):
            return {"text": "(๑) ค่าบำรุง จำนวน ๖,๐๐๐ บาท", "lines": [
                {"text": "(๑) ค่าบำรุง", "confidence": 0.97}, {"text": "จำนวน ๖,๐๐๐ บาท", "confidence": 0.96}]}
    client, _ = make_client(tmp_path, engine=RowEngine())
    with client:
        body = client.post("/ocr/pdf", content=tiny_pdf(1), headers={"content-type": "application/pdf", "x-yru-pages": "1"}).json()
    assert body["pages"][0]["text"] == "(๑) ค่าบำรุง จำนวน ๖,๐๐๐ บาท"
    assert len(body["pages"][0]["lines"]) == 2
