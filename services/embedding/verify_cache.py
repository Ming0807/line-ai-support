"""Prove model loading/encoding with only configured cache and no sockets."""
import json
import math
import socket
from app import EmbeddingSettings, cached_snapshot, load_model, validated_vectors

settings = EmbeddingSettings.from_env()
snapshot = cached_snapshot(settings)
attempts = []


def blocked_connect(*args, **kwargs):
    attempts.append(True)
    raise RuntimeError("OFFLINE_VERIFICATION_NETWORK_BLOCKED")


socket.socket.connect = blocked_connect
socket.socket.connect_ex = blocked_connect
model = load_model(settings, snapshot)
assert model.get_sentence_embedding_dimension() == 384
vectors = validated_vectors(model.encode(["query: การเทียบโอนรายวิชาต้องทำอย่างไร", "query: How do I transfer course credits?",
                                        "passage: Reviewed course credit transfer information"], normalize_embeddings=True,
                                       show_progress_bar=False).tolist(), 3)
assert not attempts, "The offline model attempted network access"
print(json.dumps({"model": settings.model, "revision": settings.revision, "cache": str(settings.cache_dir), "snapshot": str(snapshot),
                  "dimension": 384, "lengths": [len(x) for x in vectors], "norms": [round(math.sqrt(sum(v*v for v in x)), 6) for x in vectors],
                  "networkAttempts": len(attempts), "loadedOffline": True}, ensure_ascii=False))
