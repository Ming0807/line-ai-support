import importlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import threading
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

    def test_count_reports_exact_prefixed_boundary_without_encoding_or_text(self):
        calls = []
        def tokens(text, **kwargs):
            calls.append((text, kwargs))
            return {"input_ids": [1] * (512 if text.endswith("boundary512") else 513)}
        self.model.tokenizer = tokens
        with self.client() as client:
            result = client.post("/tokens/count", json={"texts": ["boundary512", "boundary513"], "type": "passage"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json(), {"model": module.MODEL, "revision": REVISION, "dimension": 384, "tokenCounts": [512, 513]})
            self.assertEqual(calls, [("passage: boundary512", {"truncation": False, "add_special_tokens": True}), ("passage: boundary513", {"truncation": False, "add_special_tokens": True})])
            self.assertEqual(result.headers["cache-control"], "no-store")
            self.assertNotIn("boundary", result.text)
            self.assertEqual(self.model.inputs, [])
            self.assertEqual(client.post("/embed", json={"text": "boundary512", "type": "passage"}).status_code, 200)
            self.assertEqual(client.post("/embed", json={"text": "boundary513", "type": "passage"}).status_code, 422)
            self.assertEqual(len(self.model.inputs), 1)

    def test_count_invalid_batches_have_fixed_private_diagnostics(self):
        with self.client() as client:
            private = "private-invalid-count-fixture"
            for value in [{"texts": []}, {"texts": ["x"] * 17}, {"texts": ["ไทย" * 1000]}, {"texts": [" "]}, {"texts": [private], "type": "query"}, {"texts": [private], "extra": private}]:
                result = client.post("/tokens/count", json=value)
                self.assertEqual(result.status_code, 422)
                self.assertEqual(result.json(), {"detail": "EMBEDDING_INPUT_INVALID"})
                self.assertNotIn(private, result.text)
                self.assertEqual(result.headers["cache-control"], "no-store")
            self.assertEqual(self.model.inputs, [])

    def test_count_authentication_precedes_tokenizer(self):
        called = []
        self.model.tokenizer = lambda text, **kwargs: called.append(text)
        self.settings = module.EmbeddingSettings(cache_dir=self.root, api_key="fixture-only-test-key")
        with self.client() as client:
            result = client.post("/tokens/count", json={"texts": ["private-fixture"]})
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result.headers["cache-control"], "no-store")
            self.assertEqual(called, [])
            self.model.tokenizer = lambda text, **kwargs: {"input_ids": [1] * 10}
            self.assertEqual(client.post("/tokens/count", json={"texts": ["ok"]}, headers={"authorization": "Bearer fixture-only-test-key"}).status_code, 200)
        self.settings = module.EmbeddingSettings(cache_dir=self.root)
        with TestClient(module.create_app(self.settings, model_factory=lambda p: self.model), client=("203.0.113.10", 1234)) as client:
            self.assertEqual(client.post("/tokens/count", json={"texts": ["ok"]}).status_code, 403)

    def test_count_rejects_malformed_tokenizer_outputs_safely(self):
        with self.client() as client:
            for output in [None, {}, {"input_ids": "private-tokenizer-fixture"}, {"input_ids": []}, {"input_ids": [True]}, {"input_ids": [-1]}, {"input_ids": [1] * 16385}]:
                self.model.tokenizer = lambda text, value=output, **kwargs: value
                result = client.post("/tokens/count", json={"texts": ["private-source-fixture"]})
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.json(), {"detail": "EMBEDDING_UNAVAILABLE"})
                self.assertNotIn("private", result.text)
            self.assertEqual(self.model.inputs, [])

    def test_count_and_encode_share_non_queuing_lock_and_recover(self):
        entered, release = threading.Event(), threading.Event()
        def tokens(text, **kwargs):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("TEST_RELEASE_REQUIRED")
            return {"input_ids": [1] * 10}
        self.model.tokenizer = tokens
        results = []
        with self.client() as client:
            worker = threading.Thread(target=lambda: results.append(client.post("/tokens/count", json={"texts": ["held"]})))
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                for route, body in [("/tokens/count", {"texts": ["second"]}), ("/embed", {"text": "second"})]:
                    result = client.post(route, json=body)
                    self.assertEqual(result.status_code, 503)
                    self.assertEqual(result.json(), {"detail": "EMBEDDING_BUSY"})
            finally:
                release.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(results[0].status_code, 200)
            self.assertEqual(client.post("/tokens/count", json={"texts": ["recovered"]}).status_code, 200)

    def test_request_body_is_bounded_before_validation(self):
        with self.client() as client:
            for kwargs in [{"content": b'{"texts":["ok"]}' + b' ' * 600000}, {"json": {"texts": ["ok"]}, "headers": {"content-length": "600001"}}]:
                result = client.post("/tokens/count", **kwargs)
                self.assertEqual(result.status_code, 413)
                self.assertEqual(result.json(), {"detail": "EMBEDDING_INPUT_INVALID"})
                self.assertEqual(result.headers["cache-control"], "no-store")
            self.assertEqual(self.model.inputs, [])

    def test_streamed_body_without_content_length_is_still_bounded(self):
        with self.client() as client:
            result = client.post("/tokens/count", content=iter([b" " * 300001, b" " * 300001]))
            self.assertEqual(result.status_code, 413)
            self.assertEqual(result.json(), {"detail": "EMBEDDING_INPUT_INVALID"})
            self.assertEqual(self.model.inputs, [])

    def test_existing_routes_validation_does_not_echo_source_and_is_private(self):
        with self.client() as client:
            for route, body in [("/embed", {"text": "private-original", "type": "wrong"}), ("/embed/batch", {"texts": ["private-original"], "type": "wrong"})]:
                result = client.post(route, json=body)
                self.assertEqual(result.status_code, 422)
                self.assertEqual(result.json(), {"detail": "EMBEDDING_INPUT_INVALID"})
                self.assertEqual(result.headers["cache-control"], "no-store")
                self.assertNotIn("private-original", result.text)
            self.assertEqual(client.get("/health").headers["cache-control"], "no-store")

    def test_full_escaped_json_batch_fits_the_body_limit(self):
        with self.client() as client:
            body = json.dumps({"texts": ["\x00" * 6000] * 16, "type": "passage"})
            self.assertLess(len(body.encode("utf-8")), 600000)
            result = client.post("/tokens/count", content=body, headers={"content-type": "application/json"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["tokenCounts"], [10] * 16)

    def test_invalid_json_does_not_echo_private_count_text(self):
        with self.client() as client:
            result = client.post("/tokens/count", content='{"texts":["private-source"],oops}', headers={"content-type": "application/json"})
            self.assertEqual(result.status_code, 422)
            self.assertEqual(result.json(), {"detail": "EMBEDDING_INPUT_INVALID"})
            self.assertNotIn("private-source", result.text)


if __name__ == "__main__":
    unittest.main()
