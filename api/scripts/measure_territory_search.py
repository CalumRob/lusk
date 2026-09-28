"""Read-only static/search timing harness (no response bodies printed).

Example: python api/scripts/measure_territory_search.py https://SITE https://API
Requires API to expose /api/territories/search? q=rennes&limit=8; undeployed
routes are reported as unavailable. Ten sequential samples are first-sample
and warm-path samples, NOT process-cold measurements. Run from a client
representative of the Pi and separately from a browser network panel for
transfer/cache provenance. Process-cold requires an operator-approved restart.
"""
import json
import statistics
import sys
import time
import urllib.error
import urllib.request


def sample(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read()
            elapsed = (time.perf_counter() - start) * 1000
            return {"status": response.status, "ms": round(elapsed, 2),
                    "bytes": len(body), "cache_control": response.headers.get("Cache-Control"),
                    "etag": response.headers.get("ETag")}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "error": "HTTP error"}
    except (urllib.error.URLError, TimeoutError) as error:
        return {"error": type(error).__name__}


def main(site: str, api: str) -> None:
    static_url = site.rstrip("/") + "/data/territoires.json"
    search_url = api.rstrip("/") + "/api/territories/search?q=rennes&limit=8"
    results = {"static": [], "search": []}
    for _ in range(10):
        results["static"].append(sample(static_url))
        results["search"].append(sample(search_url))
    for name, rows in results.items():
        ok = [row for row in rows if "ms" in row]
        print(json.dumps({"path": name, "first_sample": rows[0], "warm_samples": rows[1:],
                          "p50_ms": statistics.median(r["ms"] for r in ok) if ok else None,
                          "p95_ms": sorted(r["ms"] for r in ok)[max(0, (95 * len(ok) + 99) // 100 - 1)] if ok else None},
                         ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: measure_territory_search.py SITE_ORIGIN API_ORIGIN")
    main(sys.argv[1], sys.argv[2])
