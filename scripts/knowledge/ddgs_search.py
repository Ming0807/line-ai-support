"""Fixed DuckDuckGo backend for the bounded server-owned search connector."""

import json
import sys
from importlib.metadata import version


def main():
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise ValueError("INVALID_INPUT")
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != {"query"}:
        raise ValueError("INVALID_INPUT")
    query = value["query"]
    if not isinstance(query, str) or not 1 <= len(query) <= 500:
        raise ValueError("INVALID_INPUT")

    if version("ddgs") != "9.16.1":
        raise ValueError("UNSUPPORTED_VERSION")
    from ddgs import DDGS

    results = DDGS(timeout=8).text(query, backend="duckduckgo", region="th-th", max_results=8)
    projected = [{"title": item.get("title"), "href": item.get("href"), "body": item.get("body", "")} for item in results]
    sys.stdout.write(json.dumps(projected, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not print provider exceptions, queries, or process environment.
        sys.exit(1)
