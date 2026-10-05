import importlib
import math
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"


class FakeModel:
    def __init__(self):
        self.inputs = []
        self.dim = 384
        self.tokenizer = lambda text, **kwargs: {"input_ids": list(range(513 if "oversized" in text else 10))}

    def get_sentence_embedding_dimension(self):
        return self.dim

    def encode(self, texts, **kwargs):
        self.inputs.append((texts, kwargs))
        return types.SimpleNamespace(tolist=lambda: [[1.0] + [0.0] * (self.dim - 1) for _ in texts])


# The existing app imports its model eagerly. Prevent a model load/download in unit RED.
with patch.dict(sys.modules, {"sentence_transformers": types.SimpleNamespace(SentenceTransformer=lambda *a, **k: FakeModel())}):
    module = importlib.import_module("app")


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.snapshot = self.root / "hub" / "models--intfloat--multilingual-e5-small" / "snapshots" / REVISION
        self.snapshot.mkdir(parents=True)
        for name in ["config.json", "modules.json", "model.safetensors", "tokenizer.json", "1_Pooling/config.json"]:
            path = self.snapshot / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("fixture", encoding="utf-8")
        self.model = FakeModel()
        self.settings = module.EmbeddingSettings(cache_dir=self.root)

    def client(self, **kwargs):
        return TestClient(module.create_app(self.settings, model_factory=lambda path: self.model, **kwargs), client=("127.0.0.1", 1234))

    def test_health_reports_loaded_identity_without_path(self):
        with self.client() as client:
            result = client.get("/health")
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json(), {"status": "ok", "model": "intfloat/multilingual-e5-small", "revision": REVISION, "dimension": 384})
            self.assertNotIn(str(self.root), result.text)

    def test_query_and_passage_prefix_and_normalization(self):
        with self.client() as client:
            for kind, text in [("query", "การเทียบโอนรายวิชาต้องทำอย่างไร"), ("passage", "Credit transfer rules")]:
                response = client.post("/embed", json={"text": text, "type": kind})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()["embedding"]), 384)
                self.assertAlmostEqual(math.sqrt(sum(x*x for x in response.json()["embedding"])), 1)
                self.assertEqual(self.model.inputs[-1][0], [kind + ": " + text])
                self.assertTrue(self.model.inputs[-1][1]["normalize_embeddings"])

    def test_batch_preserves_passage_order(self):
        with self.client() as client:
            response = client.post("/embed/batch", json={"texts": ["หนึ่ง", "two"], "type": "passage"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["embeddings"]), 2)
            self.assertEqual(self.model.inputs[-1][0], ["passage: หนึ่ง", "passage: two"])

    def test_invalid_requests_do_not_encode(self):
        with self.client() as client:
            for value in [{"text": ""}, {"text": "  "}, {"text": "hello", "type": "unknown"}, {"text": "ไทย"*3000}, {"text": "hello", "extra": True}]:
                self.assertEqual(client.post("/embed", json=value).status_code, 422)
            self.assertEqual(client.post("/embed/batch", json={"texts": ["x"]*17, "type": "passage"}).status_code, 422)
            self.assertEqual(self.model.inputs, [])

    def test_token_limit_rejects_without_truncating(self):
        with self.client() as client:
            response = client.post("/embed", json={"text": "oversized", "type": "query"})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"], "EMBEDDING_INPUT_TOO_LONG")
            self.assertEqual(self.model.inputs, [])

    def test_wrong_dimension_is_not_reported_healthy(self):
        self.model.dim = 383
        with self.assertRaisesRegex(RuntimeError, "EMBEDDING_MODEL_DIMENSION_INVALID"):
            with self.client():
                pass

    def test_missing_cache_fails_without_factory_or_download(self):
        (self.snapshot / "model.safetensors").unlink()
        called = []
        with self.assertRaisesRegex(RuntimeError, "EMBEDDING_CACHE_MISSING"):
            with TestClient(module.create_app(self.settings, model_factory=lambda p: called.append(p))):
                pass
        self.assertEqual(called, [])

    def test_key_authenticates_health_and_inference(self):
        self.settings = module.EmbeddingSettings(cache_dir=self.root, api_key="fixture-only-test-key")
        with self.client() as client:
            self.assertEqual(client.get("/health").status_code, 401)
            self.assertEqual(client.post("/embed", json={"text": "hi"}).status_code, 401)
            self.assertEqual(client.get("/health", headers={"Authorization": "Bearer fixture-only-test-key"}).status_code, 200)

    def test_non_loopback_binding_requires_key(self):
        with self.assertRaisesRegex(ValueError, "EMBEDDING_AUTH_REQUIRED"):
            module.EmbeddingSettings(cache_dir=self.root, host="0.0.0.0")

    def test_no_key_denies_non_loopback_clients_even_if_bind_is_misconfigured(self):
        with TestClient(module.create_app(self.settings, model_factory=lambda p: self.model), client=("203.0.113.10", 1234)) as client:
            self.assertEqual(client.get("/health").status_code, 403)

    def test_runtime_tokenizer_failure_is_controlled(self):
        def broken(text, **kwargs):
            raise RuntimeError("private source/path")
        self.model.tokenizer = broken
        with self.client() as client:
            response = client.post("/embed", json={"text": "controlled fixture"})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private", response.text)


if __name__ == "__main__":
    unittest.main()
