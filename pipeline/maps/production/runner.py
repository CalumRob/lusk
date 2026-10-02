"""Shared, composable map production contract (no family facts in foundation)."""
from dataclasses import dataclass, field
from hashlib import sha256
import json
from pathlib import Path
import struct
import os
import tempfile
from typing import Mapping, Protocol, Sequence
import zlib
from time import perf_counter


@dataclass(frozen=True)
class Foundation:
    version: str
    framing: Mapping = field(default_factory=dict)
    geography: Mapping = field(default_factory=dict)
    ground: Mapping = field(default_factory=dict)
    composition: Mapping = field(default_factory=dict)


@dataclass(frozen=True)
class Recipe:
    name: str
    version: int
    foundation: Foundation
    family: str
    required_fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class MapSet:
    layers: Mapping[str, Sequence[Mapping]]


@dataclass(frozen=True)
class Binding:
    family: str
    map_set: MapSet


@dataclass(frozen=True)
class Profile:
    name: str
    size: tuple[int, int]
    context: bool
    furniture: bool
    transparent_outside: bool


PROFILES = {
    "inspection": Profile("inspection", (3200, 3200), True, True, False),
    "inline": Profile("inline", (900, 900), False, False, True),
}


class FamilyAdapter(Protocol):
    """One run's family-specific preparation, rendering, and validation seam."""
    def preflight(self, recipe: Recipe, binding: Binding) -> None: ...
    def render_identity(self) -> Mapping: ...
    def input_identity(self) -> Mapping: ...
    def render(self, recipe: Recipe, feature: Mapping, profile: Profile,
               output_dir: Path) -> Path: ...
    def validate(self, path: Path, feature: Mapping, profile: Profile) -> None: ...


@dataclass(frozen=True)
class RunResult:
    outputs: tuple[Mapping, ...]
    manifest: Mapping
    qa: Mapping


def _canonical_input(value, geometry_hashes: dict[int, tuple[str, int]]):
    """Replace heavyweight geometry values with stable binary fingerprints."""
    if isinstance(value, Mapping):
        return {
            str(key): _canonical_input(item, geometry_hashes)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_canonical_input(item, geometry_hashes) for item in value]
    as_wkb = getattr(value, "asWkb", None)
    if callable(as_wkb):
        identity = id(value)
        fingerprint = geometry_hashes.get(identity)
        if fingerprint is None:
            wkb = bytes(as_wkb())
            fingerprint = (sha256(wkb).hexdigest(), len(wkb))
            geometry_hashes[identity] = fingerprint
        digest, size = fingerprint
        return {"geometry_wkb_sha256": digest, "geometry_wkb_bytes": size}
    return value


def _input_sha256(feature: Mapping, geometry_hashes: dict[int, tuple[str, int]]) -> str:
    canonical = _canonical_input(feature, geometry_hashes)
    encoded = json.dumps(canonical, sort_keys=True, default=str).encode()
    return sha256(encoded).hexdigest()


def _profile_input_sha256(feature: Mapping, profile: Profile,
                          geometry_hashes: dict[int, tuple[str, int]]) -> str:
    """Hash only map-ready feature content consumed by the selected profile."""
    territory = feature["territory"]
    selected = {
        "territory": {"kind": territory["kind"], "code": territory["code"]},
        "mode": feature["mode"],
        "analytical_geometry": feature.get("analytical_geometry", feature["geometry"]),
        "region_geometry": feature.get("region_geometry"),
        "extent": feature.get("extent"),
    }
    if profile.name == "inspection":
        selected["territory"]["name"] = territory["name"]
        selected["geometry"] = feature.get("geometry")
    return _input_sha256(selected, geometry_hashes)


def _render_identity(recipe: Recipe, scope: str, profiles: Sequence[str],
                     renderer_identity: Mapping, authoritative_inputs: Mapping) -> str:
    if not isinstance(renderer_identity, Mapping) or not renderer_identity:
        raise ValueError("family adapter must provide a stable render identity")
    if not isinstance(authoritative_inputs, Mapping):
        raise ValueError("family adapter must provide authoritative input identities")
    contract = {
        "recipe": {
            "name": recipe.name,
            "version": recipe.version,
            "family": recipe.family,
            "required_fields": recipe.required_fields,
            "foundation": {
                "version": recipe.foundation.version,
                "framing": recipe.foundation.framing,
                "geography": recipe.foundation.geography,
                "ground": recipe.foundation.ground,
                "composition": recipe.foundation.composition,
            },
        },
        "scope": scope,
        "profiles": [
            {
                "name": PROFILES[name].name,
                "size": PROFILES[name].size,
                "context": PROFILES[name].context,
                "furniture": PROFILES[name].furniture,
                "transparent_outside": PROFILES[name].transparent_outside,
            }
            for name in sorted(profiles)
        ],
        "family_renderer": renderer_identity,
        "authoritative_inputs": authoritative_inputs,
    }
    try:
        encoded = json.dumps(
            contract, sort_keys=True, separators=(",", ":"), default=str
        ).encode()
    except (TypeError, ValueError) as error:
        raise ValueError(f"render identity must be JSON serializable: {error}") from error
    return sha256(encoded).hexdigest()


def _png_contract(path: Path, profile: Profile) -> None:
    """Check PNG signature, IHDR, dimensions, chunk CRCs and complete zlib stream."""
    data = path.read_bytes()
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", data[16:29])
    if (width, height) != profile.size:
        raise ValueError(f"{profile.name} dimensions {(width,height)} != {profile.size}")
    if depth != 8 or colour not in (2, 6) or compression or filtering or interlace:
        raise ValueError(f"unsupported PNG encoding in {path}")
    offset, chunks, compressed, ended = 8, 0, bytearray(), False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("truncated PNG chunk")
        size = struct.unpack(">I", data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        end = offset + 12 + size
        if end > len(data):
            raise ValueError("truncated PNG payload")
        payload = data[offset+8:offset+8+size]
        crc = struct.unpack(">I", data[offset+8+size:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ValueError("PNG chunk checksum mismatch")
        if kind == b"IDAT":
            compressed.extend(payload)
        if kind == b"IEND":
            ended = True
            break
        offset = end
        chunks += 1
    if not ended:
        raise ValueError("PNG has no IEND")
    raw = zlib.decompress(bytes(compressed))
    channels = 4 if colour == 6 else 3
    if len(raw) != height * (width * channels + 1):
        raise ValueError("PNG pixel stream is incomplete")
    if profile.transparent_outside:
        if colour != 6:
            raise ValueError("inline PNG must use RGBA for its alpha channel")
        alpha = _alpha_values(raw, width)
        if not any(value == 0 for value in alpha):
            raise ValueError("inline PNG must contain transparent alpha samples")
        if not any(value == 255 for value in alpha):
            raise ValueError("inline PNG must contain opaque alpha samples")


def _alpha_values(raw: bytes, width: int) -> bytes:
    """Decode PNG filters and return alpha bytes for mask QA."""
    channels = 4
    stride = width * channels
    previous = bytearray(stride)
    alpha = bytearray()
    for y in range(len(raw) // (stride + 1)):
        start = y * (stride + 1)
        method, scan = raw[start], bytearray(raw[start+1:start+1+stride])
        for i in range(stride):
            a = scan[i-channels] if i >= channels else 0
            b = previous[i]
            c = previous[i-channels] if i >= channels else 0
            if method == 1: scan[i] = (scan[i] + a) & 255
            elif method == 2: scan[i] = (scan[i] + b) & 255
            elif method == 3: scan[i] = (scan[i] + ((a+b)//2)) & 255
            elif method == 4:
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                scan[i] = (scan[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            elif method != 0: raise ValueError("invalid PNG filter")
        alpha.extend(scan[3::4])
        previous = scan
    return bytes(alpha)


def preflight(recipe: Recipe, binding: Binding, scope: str, profiles: Sequence[str], adapter: FamilyAdapter) -> None:
    if recipe.version < 1 or not recipe.name or not recipe.foundation.version:
        raise ValueError("recipe and foundation must be versioned")
    if binding.family != recipe.family:
        raise ValueError("map-set family does not match recipe")
    if scope not in {"representative", "full"}:
        raise ValueError("scope must be representative or full")
    if not profiles or set(profiles) - PROFILES.keys():
        raise ValueError("unknown or empty export profile request")
    if len(set(profiles)) != len(profiles):
        raise ValueError("duplicate export profile")
    if not binding.map_set.layers:
        raise ValueError("map-set has no authoritative inputs")
    identities = set()
    for layer, features in binding.map_set.layers.items():
        if not features:
            raise ValueError(f"map-set layer {layer} has no territory coverage")
        for feature in features:
            missing = set(recipe.required_fields) - feature.keys()
            if missing: raise ValueError(f"{layer} missing map-ready fields {sorted(missing)}")
            if not feature.get("geometry"):
                raise ValueError(f"{layer} has missing geometry")
            if not feature.get("territory") or not feature.get("mode"):
                raise ValueError(f"{layer} feature is missing territory or mode identity")
            identity = (feature.get("territory", {}).get("kind"),
                        feature.get("territory", {}).get("code"), feature.get("mode"))
            if identity in identities:
                raise ValueError(f"duplicate map-set territory/mode coverage: {identity}")
            identities.add(identity)
    adapter.preflight(recipe, binding)


def run_production(recipe: Recipe, binding: Binding, scope: str,
                   requested_profiles: Sequence[str], adapter: FamilyAdapter,
                   output_dir: str | Path, *, refresh: bool = False) -> RunResult:
    """Validate first; render each feature/profile and return checked evidence."""
    run_started = perf_counter()
    preflight_started = perf_counter()
    preflight(recipe, binding, scope, requested_profiles, adapter)
    preflight_seconds = perf_counter() - preflight_started
    print(f"[maps] input preflight: {preflight_seconds:.1f}s", flush=True)
    renderer_identity = adapter.render_identity()
    authoritative_inputs = adapter.input_identity()
    render_identity = _render_identity(
        recipe, scope, requested_profiles, renderer_identity, authoritative_inputs
    )
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_manifest_path = output_dir / ".production-manifest.json"
    try:
        cache_manifest = json.loads(cache_manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache_manifest = {"outputs": {}}
    if not isinstance(cache_manifest, dict) or not isinstance(cache_manifest.get("outputs"), dict):
        cache_manifest = {"outputs": {}}
    cached_outputs = {key: value for key, value in cache_manifest["outputs"].items()
                      if isinstance(key, str) and isinstance(value, dict)}
    next_cached_outputs = dict(cached_outputs)
    preparation_seconds = 0.0
    prepare_run = getattr(adapter, "prepare_run", None)
    if callable(prepare_run):
        preparation_started = perf_counter()
        prepare_run(recipe, binding, requested_profiles, output_dir, refresh=refresh)
        preparation_seconds = perf_counter() - preparation_started
        print(f"[maps] shared source preparation: {preparation_seconds:.1f}s", flush=True)
    outputs = []
    artifact_total = sum(len(features) for features in binding.map_set.layers.values()) * len(requested_profiles)
    artifact_number = 0
    geometry_hashes: dict[int, tuple[str, int]] = {}
    input_hash_seconds = 0.0
    for layer, features in binding.map_set.layers.items():
        for feature in features:
            hash_started = perf_counter()
            input_sha256 = _input_sha256(feature, geometry_hashes)
            hash_seconds = perf_counter() - hash_started
            input_hash_seconds += hash_seconds
            print(
                f"[maps] input fingerprint {feature['territory']['kind']}/"
                f"{feature['territory']['code']} {feature['mode']}: {hash_seconds:.2f}s",
                flush=True,
            )
            for name in requested_profiles:
                profile = PROFILES[name]
                key = f"{feature['territory']['kind']}/{feature['territory']['code']}/{feature['mode']}/{name}"
                profile_input_sha256 = _profile_input_sha256(feature, profile, geometry_hashes)
                effective_contract = {"input": profile_input_sha256,
                                      "recipe": {"name": recipe.name, "version": recipe.version,
                                          "family": recipe.family,
                                          "foundation": {"version": recipe.foundation.version,
                                              "framing": recipe.foundation.framing,
                                              "geography": recipe.foundation.geography,
                                              "ground": recipe.foundation.ground,
                                              "composition": recipe.foundation.composition}},
                                      "renderer": (adapter.profile_identity(profile, feature)
                                          if callable(getattr(adapter, "profile_identity", None))
                                          else renderer_identity),
                                      "profile": {"name": name, "size": profile.size,
                                                  "context": profile.context,
                                                  "furniture": profile.furniture,
                                                  "transparent_outside": profile.transparent_outside}}
                effective_inputs = getattr(adapter, "effective_input_identity", None)
                if callable(effective_inputs):
                    effective_contract["displayed_content"] = effective_inputs(feature, profile)
                effective_identity = sha256(json.dumps(effective_contract, sort_keys=True,
                    separators=(",", ":")).encode()).hexdigest()
                previous = cached_outputs.get(key, {})
                path = Path(previous.get("path", "")) if previous.get("path") else None
                reusable = (not refresh and previous.get("effective_identity") == effective_identity
                    and path is not None and path.is_file()
                    and sha256(path.read_bytes()).hexdigest() == previous.get("output_sha256"))
                render_seconds = 0.0
                decision = "reused-output" if reusable else "rendered"
                if reusable:
                    report_reuse = getattr(adapter, "record_reused_output", None)
                    if callable(report_reuse):
                        report_reuse(feature, profile, output_dir)
                if not reusable:
                    render_started = perf_counter()
                    path = Path(adapter.render(recipe, feature, profile, output_dir))
                    render_seconds = perf_counter() - render_started
                if not path.is_file() or path.stat().st_size == 0:
                    raise ValueError(f"renderer did not produce a nonempty artifact: {path}")
                validation_started = perf_counter()
                _png_contract(path, profile)
                adapter.validate(path, feature, profile)
                validation_seconds = perf_counter() - validation_started
                output_sha256 = sha256(path.read_bytes()).hexdigest()
                next_cached_outputs[key] = {"path": str(path), "effective_identity": effective_identity,
                                            "output_sha256": output_sha256}
                artifact_number += 1
                outputs.append({"path": str(path), "bytes": path.stat().st_size,
                    "family": recipe.family, "territory": feature.get("territory"),
                    "mode": feature.get("mode"), "profile": name,
                    "profile_size": list(profile.size), "input_sha256": profile_input_sha256,
                    "render_identity": render_identity, "output_sha256": output_sha256,
                    "effective_identity": effective_identity, "decision": decision,
                    "render_seconds": round(render_seconds, 3),
                    "validation_seconds": round(validation_seconds, 3)})
                print(
                    f"[maps] {artifact_number}/{artifact_total} "
                    f"{feature['territory']['kind']}/{feature['territory']['code']} "
                    f"{feature['mode']} {name}: render={render_seconds:.1f}s "
                    f"QA={validation_seconds:.1f}s",
                    flush=True,
                )
    elapsed_seconds = perf_counter() - run_started
    stage_report = [{"stage": "adapter-preparation-total", "profile": "shared",
        "decision": "built", "seconds": round(preparation_seconds, 3)}]
    report_hook = getattr(adapter, "stage_report", None)
    if callable(report_hook):
        stage_report.extend(report_hook())
    fd, temporary_manifest = tempfile.mkstemp(prefix=".production-manifest-", suffix=".tmp", dir=output_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"outputs": next_cached_outputs}, stream, indent=2, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_manifest, cache_manifest_path)
    finally:
        if os.path.exists(temporary_manifest):
            os.unlink(temporary_manifest)
    approval_members = sorted(
        (item["territory"]["kind"], item["territory"]["code"], item["mode"],
         item["profile"], item["effective_identity"])
        for item in outputs
    )
    approval_pairs_complete = all(
        {item["profile"] for item in outputs if item["territory"] == feature["territory"]
         and item["mode"] == feature["mode"]} == {"inspection", "inline"}
        for features in binding.map_set.layers.values() for feature in features
    )
    manifest = {"recipe": recipe.name, "recipe_version": recipe.version,
                "foundation_version": recipe.foundation.version, "family": recipe.family,
                "renderer_identity": renderer_identity,
                "authoritative_inputs": authoritative_inputs,
                "render_identity": render_identity,
                "approval_identity": sha256(json.dumps(approval_members, separators=(",", ":")).encode()).hexdigest(),
                "approval_members": approval_members,
                "approval_pairs_complete": approval_pairs_complete,
                "stage_report": stage_report,
                "scope": scope, "preflight_seconds": round(preflight_seconds, 3),
                "preparation_seconds": round(preparation_seconds, 3),
                "input_hash_seconds": round(input_hash_seconds, 3),
                "elapsed_seconds": round(elapsed_seconds, 3), "outputs": outputs}
    qa = {"status": "passed", "artifact_count": len(outputs),
          "profile_counts": {name: sum(item["profile"] == name for item in outputs)
                              for name in requested_profiles},
          "preflight_seconds": round(preflight_seconds, 3),
          "preparation_seconds": round(preparation_seconds, 3),
          "stage_report": stage_report,
          "input_hash_seconds": round(input_hash_seconds, 3),
          "elapsed_seconds": round(elapsed_seconds, 3),
          "checks": ["png-signature", "png-crc", "png-decode", "profile-dimensions",
                     "family-validation"] + (["transparent-and-opaque-alpha-samples"]
                      if any(PROFILES[name].transparent_outside for name in requested_profiles) else [])}
    return RunResult(tuple(outputs), manifest, qa)
