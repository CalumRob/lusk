"""Read-only HTTP sweep for the per-resource publication rollout (#1186).

The script uses only the public JSON API. It never imports a database driver,
reads a credential, or issues a write. Resource identities, territory targets,
coordinates, intents and comparison contexts all come from API discovery.

Examples (from the repository root)::

    python api/scripts/http_sweep.py http://127.0.0.1:8001 --output before.json
    python api/scripts/http_sweep.py https://SITE --output after.json
    python api/scripts/http_sweep.py --compare before.json after.json

No public territory route exposes ``littoral_code``. C and NC commune targets
are therefore selected only when a declared ``littoral`` fixed-comparison
response identifies the focal's group. The probe requests and their evidence
are retained in the report; absence of that evidence fails target discovery.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import string
import sys
from types import SimpleNamespace
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request


REPORT_CONTRACT = "lusk-http-sweep-v1"
COMPARE_CONTRACT = "lusk-http-sweep-comparison-v1"
BATCH_CONTRACT = "semantic-read-batch-v2"
CATALOGUE_CONTRACT = "semantic-resource-catalogue-v1"
LEVELS = ("commune", "epci", "departement", "region")
LITTORAL_GROUPS = frozenset({"C", "NC"})
UNAVAILABLE_FAMILIES = frozenset({
    "scalar", "profile", "ordered_series", "named_reference", "collection", "aedar",
})
PASSING_OUTCOMES = frozenset({"available", "typed_unavailable"})
MAX_RESPONSE_BYTES = 16_000_000
DEFAULT_CONCURRENCY = 4
DEFAULT_TIMEOUT = 45.0
DEFAULT_SEARCH_QUERY_LIMIT = 96
DEFAULT_MAX_LITTORAL_PROBES = 64


class SweepError(Exception):
    """A bounded, operator-facing sweep input or discovery failure."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep the recorded status/method exact; never follow a POST redirect."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibClient:
    """Standard-library JSON transport with one timeout per request and no auth."""

    def __init__(self, base_url: str, timeout: float = DEFAULT_TIMEOUT):
        self.base_url = _validate_base_url(base_url)
        self.timeout = timeout
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    def request(self, method, path, body=None, *, timeout):
        url = self.base_url + path
        headers = {"Accept": "application/json"}
        encoded = None
        if body is not None:
            encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    return _response(None, b"", "Response exceeds the sweep body bound")
                return _response(response.status, raw, None)
        except urllib.error.HTTPError as error:
            try:
                raw = error.read(MAX_RESPONSE_BYTES + 1)
            except Exception:
                raw = b""
            if len(raw) > MAX_RESPONSE_BYTES:
                return _response(error.code, b"", "Response exceeds the sweep body bound")
            return _response(error.code, raw, None)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return _response(None, b"", f"{type(error).__name__}: {error}")


def _response(status, body, error):
    return SimpleNamespace(status=status, body=body, error=error)


def _validate_base_url(base_url):
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SweepError("base URL must be an http(s) origin without credentials")
    if parsed.username is not None or parsed.password is not None:
        raise SweepError("credentials in URLs are not accepted")
    if parsed.query or parsed.fragment:
        raise SweepError("base URL must not contain a query or fragment")
    return base_url.rstrip("/")


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _normalize_name(value):
    value = unicodedata.normalize("NFD", str(value).lower())
    value = "".join(char for char in value if not 0x0300 <= ord(char) <= 0x036F)
    return " ".join(value.replace("œ", "oe").replace("æ", "ae")
                    .replace("'", " ").replace("’", " ").replace("-", " ").split())


def _identifiers(payload, prefix=""):
    """Flatten returned content/version identities without retaining fact bodies."""
    found = {}
    if isinstance(payload, dict):
        for key, value in payload.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            lowered = key.lower()
            identity = ("version" in lowered or lowered.endswith("_identity")
                        or lowered in {"source_snapshot_id", "publication_id"})
            if identity and (value is None or isinstance(value, (str, int, float))):
                found[path] = value
            elif isinstance(value, (dict, list)):
                found.update(_identifiers(value, path))
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            found.update(_identifiers(value, f"{prefix}[{index}]"))
    return found


def _detail(raw):
    if not raw:
        return None
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if isinstance(payload, dict) and isinstance(payload.get("detail"), str):
        return payload["detail"][:500]
    return None


def _call(transport, method, path, body, timeout):
    started = time.perf_counter()
    try:
        response = transport.request(method, path, body, timeout=timeout)
        error = response.error
        status = response.status
        raw = response.body or b""
    except Exception as exc:
        response = None
        error = f"{type(exc).__name__}: {exc}"
        status = None
        raw = b""
    elapsed = round((time.perf_counter() - started) * 1000, 2)
    if error is None and len(raw) > MAX_RESPONSE_BYTES:
        error = "Response exceeds the sweep body bound"
    return {
        "http_status": status,
        "raw": raw,
        "error": error,
        "elapsed_ms": elapsed,
    }


def _get_json(transport, path, timeout, request_id, purpose):
    response = _call(transport, "GET", path, None, timeout)
    row = {
        "id": request_id,
        "purpose": purpose,
        "method": "GET",
        "route": path,
        "http_status": response["http_status"],
        "outcome": "available" if response["http_status"] == 200 and not response["error"] else "http_error",
        "identifiers": {},
        "error": response["error"],
        "elapsed_ms": response["elapsed_ms"],
    }
    payload = None
    if row["outcome"] == "available":
        try:
            payload = json.loads(response["raw"].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            row["outcome"] = "invalid_response"
            row["error"] = f"Invalid JSON: {exc}"
        else:
            if not isinstance(payload, dict):
                row["outcome"] = "invalid_response"
                row["error"] = "Expected a JSON object"
            else:
                row["identifiers"] = _identifiers(payload)
    elif row["error"] is None:
        detail = _detail(response["raw"])
        row["error"] = f"HTTP {row['http_status']}" + (f": {detail}" if detail else "")
    return row, payload


def _error_text(response):
    if response["error"]:
        return response["error"]
    detail = _detail(response["raw"])
    return f"HTTP {response['http_status']}" + (f": {detail}" if detail else "")


def _batch_read(transport, spec, timeout):
    item = {key: value for key, value in spec.items() if key != "level"}
    body = {"contract": BATCH_CONTRACT, "items": [item]}
    response = _call(transport, "POST", "/api/resources/read-batch", body, timeout)
    row = {
        "id": spec["id"],
        "key": _result_key("sweep", spec),
        "purpose": "sweep",
        "resource": spec["resource"],
        "level": spec.get("level"),
        "target": spec["target"],
        "intent": spec["intent"]["kind"],
        "context": spec["intent"].get("context"),
        "coordinates": spec.get("coordinates"),
        "route": "/api/resources/read-batch",
        "method": "POST",
        "request": body,
        "http_status": response["http_status"],
        "outcome": "http_error",
        "typed_status": None,
        "reason": None,
        "family": None,
        "identifiers": {},
        "error": _error_text(response),
        "elapsed_ms": response["elapsed_ms"],
    }
    data = None
    if response["http_status"] == 200 and not response["error"]:
        try:
            payload = json.loads(response["raw"].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            row["outcome"] = "invalid_response"
            row["error"] = f"Invalid JSON: {exc}"
        else:
            data = _parse_batch_payload(payload, spec, row)
    return row, data


def _parse_batch_payload(payload, spec, row):
    if not isinstance(payload, dict) or payload.get("contract") != BATCH_CONTRACT:
        row["outcome"] = "invalid_response"
        row["error"] = "Expected a semantic-read-batch-v2 envelope"
        return None
    results = payload.get("results")
    if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
        row["outcome"] = "invalid_response"
        row["error"] = "Expected exactly one correlated batch result"
        return None
    result = results[0]
    if result.get("id") != spec["id"] or result.get("resource") != spec["resource"]:
        row["outcome"] = "invalid_response"
        row["error"] = "Batch result correlation does not match the request"
        return None
    status = result.get("status")
    if status == "available" and isinstance(result.get("data"), dict):
        row["outcome"] = "available"
        row["typed_status"] = "available"
        row["error"] = None
        row["identifiers"] = _identifiers(result["data"])
        return result["data"]
    if (status == "publication_unavailable" and result.get("reason") == "publication_absent"
            and result.get("family") in UNAVAILABLE_FAMILIES and "data" not in result):
        row["outcome"] = "typed_unavailable"
        row["typed_status"] = "publication_unavailable"
        row["reason"] = result["reason"]
        row["family"] = result["family"]
        row["error"] = None
        return None
    row["outcome"] = "invalid_response"
    row["error"] = "Unknown or malformed typed batch outcome"
    return None


def _single_read(transport, spec, timeout, request_id):
    body = {key: value for key, value in spec.items() if key not in {"id", "level"}}
    response = _call(transport, "POST", "/api/resources/read", body, timeout)
    row = {
        "id": request_id,
        "key": _result_key("single_route_check", spec),
        "purpose": "single_route_check",
        "resource": spec["resource"],
        "level": spec.get("level"),
        "target": spec["target"],
        "intent": spec["intent"]["kind"],
        "context": spec["intent"].get("context"),
        "coordinates": spec.get("coordinates"),
        "route": "/api/resources/read",
        "method": "POST",
        "request": body,
        "http_status": response["http_status"],
        "outcome": "http_error",
        "typed_status": None,
        "reason": None,
        "family": None,
        "identifiers": {},
        "error": _error_text(response),
        "elapsed_ms": response["elapsed_ms"],
    }
    if response["http_status"] == 200 and not response["error"]:
        try:
            payload = json.loads(response["raw"].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            row["outcome"] = "invalid_response"
            row["error"] = f"Invalid JSON: {exc}"
        else:
            if isinstance(payload, dict):
                row["outcome"] = "available"
                row["error"] = None
                row["identifiers"] = _identifiers(payload)
            else:
                row["outcome"] = "invalid_response"
                row["error"] = "Expected a JSON object"
    return row


def _result_key(purpose, spec):
    return json.dumps([
        purpose,
        spec.get("resource"),
        spec.get("level"),
        spec.get("target"),
        spec.get("intent"),
        spec.get("coordinates"),
    ], ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _validate_resources(payload):
    if not isinstance(payload, dict) or payload.get("contract") != CATALOGUE_CONTRACT:
        raise SweepError("Unexpected /api/resources discovery contract")
    resources = payload.get("resources")
    if not isinstance(resources, list) or not resources:
        raise SweepError("/api/resources returned no resources")
    seen = set()
    for resource in resources:
        if not isinstance(resource, dict):
            raise SweepError("Discovery contains a malformed resource")
        resource_id = resource.get("resource_id")
        if not isinstance(resource_id, str) or not resource_id or resource_id in seen:
            raise SweepError("Discovery contains a missing or duplicate resource identity")
        seen.add(resource_id)
        for key in ("allowed_levels", "target_kinds", "intents"):
            if not isinstance(resource.get(key), list):
                raise SweepError(f"Discovery resource {resource_id} has no {key} declaration")
    return resources


def _search(transport, query, timeout, request_id):
    path = "/api/territories/search?" + urllib.parse.urlencode({"q": query, "limit": 50})
    row, payload = _get_json(transport, path, timeout, request_id, "territory_search")
    if row["outcome"] == "available":
        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            row["outcome"] = "invalid_response"
            row["error"] = "Territory search returned no candidate list"
    return row, payload


def _candidate(row, search_id):
    if not isinstance(row, dict):
        return None
    level, identity, name = row.get("type"), row.get("id"), row.get("name")
    if level not in LEVELS or not isinstance(identity, str) or not identity or not isinstance(name, str):
        return None
    return {"type": level, "id": identity, "name": name, "search_id": search_id}


def _prefixes(name):
    normalized = _normalize_name(name)
    if not normalized:
        return []
    values = {normalized[:2], normalized[:3]}
    if normalized.split():
        first = normalized.split()[0]
        values.update({first[:2], first[:3]})
    return sorted(value for value in values if len(value) >= 2)


def _discover_candidates(transport, executor, timeout, query_limit, probe_limit, report):
    pending = list(string.ascii_lowercase)
    seen_queries = set()
    candidates = []
    by_identity = {}
    search_number = 0
    while pending and len(seen_queries) < query_limit:
        batch = pending[:query_limit - len(seen_queries)]
        pending = pending[len(batch):]
        batch = [query for query in batch if query not in seen_queries]
        if not batch:
            continue
        def search_one(indexed_query):
            index, query = indexed_query
            return query, _search(
                transport, query, timeout, f"search-{search_number + index + 1:04d}")

        responses = list(executor.map(search_one, enumerate(batch)))
        for query, (row, payload) in responses:
            search_number += 1
            seen_queries.add(query)
            report["discovery_requests"].append(row)
            if row["outcome"] != "available":
                raise SweepError(f"Territory search failed for {query!r}: {row['error']}")
            exact = _candidate(payload.get("exact_code"), row["id"])
            additions = ([exact] if exact else []) + [
                candidate for value in payload["candidates"]
                if (candidate := _candidate(value, row["id"])) is not None
            ]
            for candidate in additions:
                key = (candidate["type"], candidate["id"])
                if key not in by_identity:
                    by_identity[key] = candidate
                    candidates.append(candidate)
                for prefix in _prefixes(candidate["name"]):
                    if prefix not in seen_queries and prefix not in pending:
                        pending.append(prefix)
        communes = sum(candidate["type"] == "commune" for candidate in candidates)
        missing_level = any(not any(candidate["type"] == level for candidate in candidates)
                            for level in LEVELS)
        if not missing_level and communes >= probe_limit:
            pending.clear()
    missing = [level for level in LEVELS
               if not any(candidate["type"] == level for candidate in candidates)]
    if missing:
        raise SweepError("Territory search did not expose targets for: " + ", ".join(missing))
    return candidates


def _coordinates(resource):
    """Select one producer-declared point; never invent an axis or value."""
    cellule = resource.get("cellule") or {}
    coordinates = cellule.get("coordinates") or []
    combinations = cellule.get("valid_combinations") or []
    default = cellule.get("default_point")
    point = dict(default) if isinstance(default, dict) else {}
    if combinations and isinstance(combinations[0], dict):
        matching = next((combination for combination in combinations
                         if all(combination.get(axis) == value for axis, value in point.items())), None)
        point = dict(matching or combinations[0])
    for coordinate in coordinates:
        if not isinstance(coordinate, dict):
            continue
        axis = coordinate.get("name")
        values = coordinate.get("values")
        if axis and axis not in point and isinstance(values, list) and values:
            first = values[0]
            if isinstance(first, dict) and first.get("value") is not None:
                point[axis] = first["value"]
    if not point:
        for axis, values in resource.get("axis_values") or []:
            if values:
                point[axis] = values[0]
    if not point:
        return None
    return {axis: [str(value)] for axis, value in point.items()}


def _fixed_context(resource, target):
    contexts = list(resource.get("context_values") or [])
    if not contexts:
        return "default"
    level = target["type"]
    if level == "commune" and target.get("selection") in {"littoral:C", "littoral:NC"}:
        if "littoral" in contexts:
            return "littoral"
    if level in {"epci", "departement"} and "same_level" in contexts:
        return "same_level"
    if level == "region" and "bretagne" in contexts:
        return "bretagne"
    return contexts[0]


def _item(resource, target, intent, request_id, *, level=None, members=()):
    body = {
        "id": request_id,
        "resource": resource["resource_id"],
        "target": {"kind": "territory", "type": target["type"], "id": target["id"]},
        "coordinates": _coordinates(resource),
        "intent": intent,
    }
    if level is not None:
        body["level"] = level
    if intent["kind"] == "selected_comparison":
        body["intent"] = {**intent, "members": list(members)}
    return body


def _littoral_group(data):
    if not isinstance(data, dict):
        return None
    comparison = data.get("comparison")
    if isinstance(comparison, dict):
        if (comparison.get("comparison_context") == "littoral"
                and comparison.get("group_id") in LITTORAL_GROUPS
                and comparison.get("territory_type", "commune") == "commune"):
            return comparison["group_id"]
    return None


def _select_littoral_targets(resources, candidates, transport, timeout, probe_limit, report):
    communes = [candidate for candidate in candidates if candidate["type"] == "commune"]
    if len(communes) > probe_limit:
        # Deterministic even coverage across the discovered name/query order,
        # rather than probing only the first alphabetically returned page.
        communes = [communes[(index * len(communes)) // probe_limit]
                    for index in range(probe_limit)]
    classifiers = [resource for resource in resources
                   if "territory" in resource["target_kinds"]
                   and "commune" in resource["allowed_levels"]
                   and "fixed_comparison" in resource["intents"]
                   and "littoral" in (resource.get("context_values") or [])]
    selected = {}
    probes = 0
    for resource in classifiers:
        for candidate in communes:
            if probes >= probe_limit or len(selected) == 2:
                break
            spec = _item(resource, candidate, {"kind": "fixed_comparison", "context": "littoral"},
                         f"probe-{probes + 1:04d}")
            row, data = _batch_read(transport, spec, timeout)
            row["purpose"] = "target_probe"
            row["key"] = _result_key("target_probe", spec)
            report["target_probes"].append(row)
            probes += 1
            group = _littoral_group(data)
            if group and group not in selected:
                selected[group] = {
                    **candidate,
                    "selection": f"littoral:{group}",
                    "classification_evidence": {
                        "resource": resource["resource_id"],
                        "probe_id": row["id"],
                        "context": "littoral",
                        "group_id": group,
                        "identifiers": row["identifiers"],
                    },
                }
            if row["outcome"] == "typed_unavailable":
                break
        if len(selected) == 2 or probes >= probe_limit:
            break
    if set(selected) != LITTORAL_GROUPS:
        raise SweepError(
            "No API-exposed littoral comparison identified both C and NC commune targets")
    return selected


def _target_payloads(candidates, littoral):
    targets = {}
    for level in LEVELS:
        if level == "commune":
            for group in ("C", "NC"):
                target = littoral[group]
                targets[f"commune:{group}"] = {
                    "kind": "territory", "type": "commune", "id": target["id"],
                    "name": target["name"], "selection": target["selection"],
                    "search_id": target["search_id"],
                    "classification_evidence": target["classification_evidence"],
                }
            continue
        candidate = next(candidate for candidate in candidates if candidate["type"] == level)
        targets[level] = {
            "kind": "territory", "type": level, "id": candidate["id"],
            "name": candidate["name"], "selection": "first_api_search_candidate",
            "search_id": candidate["search_id"],
        }
    return targets


def _members(target, candidates):
    peers = [candidate for candidate in candidates
             if candidate["type"] == target["type"] and candidate["id"] != target["id"]]
    return ([{"type": target["type"], "id": target["id"]}]
            + [{"type": peer["type"], "id": peer["id"]} for peer in peers[:2]])


def _plan_reads(resources, candidates, targets):
    plan = []
    for resource in resources:
        resource_id = resource["resource_id"]
        if "named_reference" in resource["target_kinds"] and resource.get("target_ids"):
            spec = {
                "id": f"read-{len(plan) + 1:04d}",
                "resource": resource_id,
                "level": "named_reference",
                "target": {"kind": "named_reference", "id": resource["target_ids"][0]},
                "coordinates": _coordinates(resource),
                "intent": {"kind": "facts"},
            }
            plan.append(spec)
        if "territory" not in resource["target_kinds"]:
            continue
        for level in resource["allowed_levels"]:
            if level not in LEVELS:
                raise SweepError(f"Resource {resource_id} declares unknown territory level {level}")
            focal_targets = ([targets["commune:C"], targets["commune:NC"]]
                             if level == "commune" else [targets[level]])
            for target in focal_targets:
                for intent_kind in resource["intents"]:
                    if intent_kind == "facts":
                        intent = {"kind": "facts"}
                    elif intent_kind == "fixed_comparison":
                        intent = {"kind": "fixed_comparison", "context": _fixed_context(resource, target)}
                    elif intent_kind == "selected_comparison":
                        intent = {"kind": "selected_comparison"}
                    else:
                        raise SweepError(
                            f"Resource {resource_id} declares unknown read intent {intent_kind}")
                    plan.append(_item(
                        resource, target, intent, f"read-{len(plan) + 1:04d}", level=level,
                        members=_members(target, candidates),
                    ))
    return plan


def _summarize(results, discovery_requests, target_probes):
    summary = {
        "requests": len(results),
        "http_200": sum(row["outcome"] == "available" for row in results),
        "typed_unavailable": sum(row["outcome"] == "typed_unavailable" for row in results),
        "other": sum(row["outcome"] not in PASSING_OUTCOMES for row in results),
        "physical_http_requests": len(results) + len(discovery_requests) + len(target_probes),
        "discovery_requests": len(discovery_requests),
        "target_probe_requests": len(target_probes),
    }
    return summary


def _finish(report):
    report["finished_at"] = _utc_now()
    report["summary"] = _summarize(
        report["results"], report["discovery_requests"], report["target_probes"])
    return report


def run_sweep(transport, *, base_url="http://testserver", concurrency=DEFAULT_CONCURRENCY,
              timeout=DEFAULT_TIMEOUT, search_query_limit=DEFAULT_SEARCH_QUERY_LIMIT,
              max_littoral_probes=DEFAULT_MAX_LITTORAL_PROBES):
    """Run one sweep and return its JSON-safe report (HTTP errors do not raise)."""
    if isinstance(concurrency, bool) or not isinstance(concurrency, int) or not 1 <= concurrency <= 32:
        raise SweepError("concurrency must be an integer from 1 to 32")
    if (isinstance(timeout, bool) or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout) or not 0 < timeout <= 600):
        raise SweepError("timeout must be greater than 0 and at most 600 seconds")
    if (not isinstance(search_query_limit, int) or isinstance(search_query_limit, bool)
            or not 1 <= search_query_limit <= 512):
        raise SweepError("search query limit must be an integer from 1 to 512")
    if (not isinstance(max_littoral_probes, int) or isinstance(max_littoral_probes, bool)
            or not 1 <= max_littoral_probes <= 512):
        raise SweepError("littoral probe limit must be an integer from 1 to 512")
    report = {
        "contract": REPORT_CONTRACT,
        "base_url": _validate_base_url(base_url),
        "started_at": _utc_now(),
        "finished_at": None,
        "limits": {
            "concurrency": concurrency,
            "timeout_seconds": timeout,
            "search_query_limit": search_query_limit,
            "max_littoral_probes": max_littoral_probes,
            "max_response_bytes": MAX_RESPONSE_BYTES,
        },
        "notes": [
            "No public territory route exposes littoral_code; C/NC targets are evidenced by declared littoral comparison group_id responses.",
            "Every matrix row is one semantic item request through the v2 batch route; available resources also receive one single-route facts check.",
        ],
        "targets": {},
        "discovered_resources": [],
        "discovery_requests": [],
        "target_probes": [],
        "results": [],
        "errors": [],
    }
    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="lusk-sweep") as executor:
        try:
            row, payload = _get_json(
                transport, "/api/resources", timeout, "discovery-resources", "resource_discovery")
            report["discovery_requests"].append(row)
            if row["outcome"] != "available":
                raise SweepError(f"Resource discovery failed: {row['error']}")
            resources = _validate_resources(payload)
            report["discovered_resources"] = [
                {key: resource.get(key) for key in (
                    "resource_id", "allowed_levels", "target_kinds", "target_ids", "intents",
                    "context_values", "axes")}
                for resource in resources
            ]
            candidates = _discover_candidates(
                transport, executor, timeout, search_query_limit, max_littoral_probes, report)
            littoral = _select_littoral_targets(
                resources, candidates, transport, timeout, max_littoral_probes, report)
            report["targets"] = _target_payloads(candidates, littoral)
            plan = _plan_reads(resources, candidates, report["targets"])
            pairs = list(executor.map(lambda spec: _batch_read(transport, spec, timeout), plan))
            report["results"].extend(row for row, _data in pairs)
            checked = set()
            skipped = []
            for row, _data in pairs:
                if (row["purpose"] == "sweep" and row["intent"] == "facts"
                        and row["outcome"] == "available" and row["resource"] not in checked):
                    checked.add(row["resource"])
                    spec = next(spec for spec in plan if spec["id"] == row["id"])
                    report["results"].append(_single_read(
                        transport, spec, timeout, f"single-{len(checked):04d}"))
                elif (row["purpose"] == "sweep" and row["intent"] == "facts"
                      and row["outcome"] == "typed_unavailable" and row["resource"] not in checked):
                    checked.add(row["resource"])
                    skipped.append(row["resource"])
            report["single_route_checks_skipped_publication_unavailable"] = skipped
        except SweepError as exc:
            report["errors"].append({"id": "discovery", "reason": str(exc)})
    report["errors"].extend(
        {"id": row["id"], "reason": row["error"]}
        for row in report["results"] if row["outcome"] not in PASSING_OUTCOMES)
    return _finish(report)


def summary_line(report):
    summary = report["summary"]
    return (f"SWEEP: {summary['requests']} requests | 200: {summary['http_200']} | "
            f"typed-unavailable: {summary['typed_unavailable']} | other: {summary['other']}")


def report_exit_code(report):
    return 0 if not report.get("errors") and report.get("summary", {}).get("other") == 0 else 1


def _report_index(report):
    if not isinstance(report, dict) or report.get("contract") != REPORT_CONTRACT:
        raise SweepError("Not a lusk HTTP sweep report")
    results = report.get("results")
    if not isinstance(results, list):
        raise SweepError("Sweep report has no results list")
    indexed = {}
    for row in results:
        if not isinstance(row, dict) or not isinstance(row.get("key"), str):
            raise SweepError("Sweep report contains a result without a stable key")
        if row["key"] in indexed:
            raise SweepError("Sweep report contains a duplicate result key")
        indexed[row["key"]] = row
    return indexed


def _comparison_snapshot(row):
    return {key: row.get(key) for key in (
        "http_status", "outcome", "typed_status", "reason", "family", "identifiers")}


def compare_reports(before, after):
    """Diff stable result identities; timing, batch IDs and base URLs are ignored."""
    before_index = _report_index(before)
    after_index = _report_index(after)
    changes = []
    unchanged = 0
    for key in sorted(set(before_index) | set(after_index)):
        old = before_index.get(key)
        new = after_index.get(key)
        if old is None:
            changes.append({"key": key, "kind": "added", "after": _comparison_snapshot(new)})
            continue
        if new is None:
            changes.append({"key": key, "kind": "removed", "before": _comparison_snapshot(old)})
            continue
        old_snapshot = _comparison_snapshot(old)
        new_snapshot = _comparison_snapshot(new)
        kinds = []
        if (old_snapshot["http_status"], old_snapshot["outcome"], old_snapshot["typed_status"]) != (
                new_snapshot["http_status"], new_snapshot["outcome"], new_snapshot["typed_status"]):
            kinds.append("status_changed")
        if (old_snapshot["reason"], old_snapshot["family"]) != (
                new_snapshot["reason"], new_snapshot["family"]):
            kinds.append("classification_changed")
        old_versions = old_snapshot["identifiers"] or {}
        new_versions = new_snapshot["identifiers"] or {}
        version_changes = {
            path: {"before": old_versions.get(path), "after": new_versions.get(path)}
            for path in sorted(set(old_versions) | set(new_versions))
            if old_versions.get(path) != new_versions.get(path)
        }
        if version_changes:
            kinds.append("version_changed")
        if not kinds:
            unchanged += 1
            continue
        changes.append({
            "key": key,
            "kind": "changed",
            "changes": kinds,
            "before": old_snapshot,
            "after": new_snapshot,
            "version_changes": version_changes,
        })
    target_changes = []
    old_targets = before.get("targets") or {}
    new_targets = after.get("targets") or {}
    for key in sorted(set(old_targets) | set(new_targets)):
        if old_targets.get(key) != new_targets.get(key):
            target_changes.append({"target": key, "before": old_targets.get(key),
                                   "after": new_targets.get(key)})
    return {
        "contract": COMPARE_CONTRACT,
        "summary": {
            "before_requests": len(before_index),
            "after_requests": len(after_index),
            "unchanged": unchanged,
            "changes": len(changes),
            "target_changes": len(target_changes),
        },
        "changes": changes,
        "target_changes": target_changes,
    }


def _write_or_print(payload, output):
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if output is None:
        sys.stdout.write(text)
    else:
        Path(output).write_text(text, encoding="utf-8")


def _parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url", nargs="?", help="HTTP(S) API origin, without credentials")
    parser.add_argument("--output", help="write the JSON report/diff to this UTF-8 file")
    parser.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"),
                        help="compare two sweep reports instead of making requests")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"maximum simultaneous requests (1-32, default {DEFAULT_CONCURRENCY})")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                        help=f"per-request timeout in seconds (default {DEFAULT_TIMEOUT:g})")
    parser.add_argument("--search-query-limit", type=int, default=DEFAULT_SEARCH_QUERY_LIMIT,
                        help=f"bounded public territory-search queries (default {DEFAULT_SEARCH_QUERY_LIMIT})")
    parser.add_argument("--max-littoral-probes", type=int, default=DEFAULT_MAX_LITTORAL_PROBES,
                        help=f"bounded C/NC classification probes (default {DEFAULT_MAX_LITTORAL_PROBES})")
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        if args.compare:
            if args.base_url:
                raise SweepError("base URL is not used with --compare")
            before = json.loads(Path(args.compare[0]).read_text(encoding="utf-8"))
            after = json.loads(Path(args.compare[1]).read_text(encoding="utf-8"))
            comparison = compare_reports(before, after)
            _write_or_print(comparison, args.output)
            print(f"COMPARE: {comparison['summary']['changes']} changes", file=sys.stderr)
            return 1 if comparison["changes"] or comparison["target_changes"] else 0
        if not args.base_url:
            raise SweepError("provide a base URL or --compare BEFORE AFTER")
        report = run_sweep(
            UrllibClient(args.base_url, args.timeout), base_url=args.base_url,
            concurrency=args.concurrency, timeout=args.timeout,
            search_query_limit=args.search_query_limit,
            max_littoral_probes=args.max_littoral_probes,
        )
        _write_or_print(report, args.output)
        print(summary_line(report), file=sys.stderr)
        for failure in report["errors"]:
            print(f"FAIL: {failure['id']}: {failure['reason']}", file=sys.stderr)
        return report_exit_code(report)
    except (OSError, UnicodeError, json.JSONDecodeError, SweepError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
