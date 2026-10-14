"""Production car-diversity contracts on the reviewed shared AEDAR renderer."""
from dataclasses import replace
from pathlib import Path
from uuid import uuid4
from tempfile import TemporaryDirectory
import json
import os

from aedar_maps import (AedarMapAdapter, HORIZON, LOSS_SCALE_MAX, aedar_loss_recipe, _files_sha256,
                       _aedar_representative_bases, _territory_commune_codes, _file_sha256, TERRITORIES)
from aedar_map_content import loss_map_content
from runner import Binding, MapSet
from webp_encoding import WEBP_ENCODING_CONTRACT, encode_qimage, validate_webp


def aedar_car_recipe():
    return replace(aedar_loss_recipe(), name="aedar-car-diversity", version=1)


def build_aedar_car_map_set(raw_dir, facts_path, *, scope="representative", family_config=None,
                           territory_registry_path=None):
    """Bind only car, without scanning loss fields or deriving loss caps."""
    if scope == "full":
        from network import build_full_map_set
        inventory = build_full_map_set(raw_dir, family_config=family_config,
                                       territory_registry_path=territory_registry_path)
        bases = [f for rows in inventory.map_set.layers.values() for f in rows if f["mode"] == "car"]
    elif scope == "representative":
        memberships = _territory_commune_codes(Path(raw_dir))
        bases = [{**base, "territory_codes": tuple(sorted(memberships[key]))}
                 for key, base in _aedar_representative_bases(raw_dir).items()]
    else:
        raise ValueError("Car map scope must be representative or full")
    facts_path = Path(facts_path).resolve()
    if not facts_path.is_file():
        raise FileNotFoundError(f"Missing prepared car-diversity facts: {facts_path}")
    features = tuple({**base, "mode": "car", "source_mode": "car", "facts_path": str(facts_path),
        "value_field": f"diversity_car_{HORIZON}", "measure": "diversity", "horizon": HORIZON,
        "comparison": "car-only-typequ", "scale_type": "equal-width", "scale_cap": LOSS_SCALE_MAX,
        "scale_breaks": tuple(LOSS_SCALE_MAX * i / 5 for i in range(6)), "scale_overflow": False,
        **loss_map_content("car")} for base in bases)
    return Binding("aedar", MapSet({"car-diversity": features}))


class AedarCarAdapter(AedarMapAdapter):
    """Car-only preparation, canonical WebP and the shared runner's staged writes."""

    def __init__(self, raw_dir, *, source_cache_owner=None, family_config=None, **kwargs):
        super().__init__(raw_dir, **kwargs)
        from network import _load_network_family_config
        self.family_config = family_config or _load_network_family_config()
        self.source_cache_owner = Path(source_cache_owner) if source_cache_owner is not None else None
        self._production_sources = None

    def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
        # Derivative manifests remain at their valid owner paths. Only the
        # source stages use this override; canonical map output paths do not.
        return super().prepare_run(recipe, binding, profiles,
            self.source_cache_owner or output_dir, refresh=refresh)

    @staticmethod
    def approval_pairs():
        return {(kind, code, "car") for kind, code in TERRITORIES}

    def preflight_scope(self, recipe, binding, scope, profiles):
        actual = {(f["territory"]["kind"], f["territory"]["code"])
                  for rows in binding.map_set.layers.values() for f in rows}
        if scope == "representative":
            if actual != set(TERRITORIES):
                raise ValueError("Car review requires the exact current three-territory cohort")
            return
        from network import _metadata_path
        from qgis.core import QgsFeatureRequest, QgsVectorLayer
        departments = set(map(str, self.family_config["scope"]["analytical_departments"]))
        metadata = json.loads(_metadata_path(self.raw_dir).read_text(encoding="utf-8"))
        epcis = {str(row["code"]) for row in metadata["labels"]}
        layer = QgsVectorLayer(str(self.raw_dir / "communes_limites.geojson"), "car inventory coverage", "ogr")
        fields = {"code_insee", "code_insee_du_departement", "codes_siren_des_epci"}
        if not layer.isValid() or fields - set(layer.fields().names()):
            raise ValueError("Car full coverage needs the authoritative commune inventory")
        request = QgsFeatureRequest().setSubsetOfAttributes(list(fields), layer.fields()).setFlags(QgsFeatureRequest.NoGeometry)
        communes = {str(row["code_insee"]) for row in layer.getFeatures(request)
                    if str(row["code_insee_du_departement"]) in departments}
        expected = ({("commune", code) for code in communes} | {("epci", code) for code in epcis}
                    | {("departement", code) for code in departments} | {("region", "53")})
        if not communes or actual != expected:
            raise ValueError(f"Car full territory inventory mismatch; missing={sorted(expected-actual)}, "
                             f"unexpected={sorted(actual-expected)}")
        if set(profiles) != {"inspection", "inline"}:
            raise ValueError("Full car production requires both canonical profiles")

    def current_approval_members(self, recipe, binding, profiles, renderer_identity):
        from runner import PROFILES, _effective_identity_for
        if set(profiles) != {"inspection", "inline"}:
            raise ValueError("Car approval requires both canonical profiles")
        features = [f for rows in binding.map_set.layers.values() for f in rows
                    if (f["territory"]["kind"], f["territory"]["code"], f["mode"]) in self.approval_pairs()]
        found = {(f["territory"]["kind"], f["territory"]["code"], f["mode"]) for f in features}
        if found != self.approval_pairs() or len(features) != len(self.approval_pairs()):
            raise ValueError("Full car binding lacks the exact current representative cohort")
        return sorted((f["territory"]["kind"], f["territory"]["code"], f["mode"], name,
                       _effective_identity_for(recipe, self, renderer_identity, f, PROFILES[name]))
                      for f in features for name in sorted(profiles))

    def prepare_current_approval_members(self, recipe, full_binding, profiles, renderer_identity, output_dir):
        from qgis.core import QgsProject
        paths = {f["facts_path"] for rows in full_binding.map_set.layers.values() for f in rows}
        if len(paths) != 1:
            raise ValueError("Car approval requires one authoritative prepared facts snapshot")
        representative = build_aedar_car_map_set(self.raw_dir, next(iter(paths)))
        probe = AedarCarAdapter(self.raw_dir, context_loader=self.context_loader,
            context_cache_root=self.context_cache_root, source_cache_owner=self.source_cache_owner,
            family_config=self.family_config)
        with TemporaryDirectory(prefix="lusk-car-approval-") as scratch:
            try:
                probe.begin_production_scope("representative", Path(scratch))
                probe.prepare_run(recipe, representative, profiles, Path(scratch))
                fresh = probe.current_approval_members(recipe, representative, profiles, renderer_identity)
                claimed = probe.current_approval_members(recipe, full_binding, profiles, renderer_identity)
                if fresh != claimed:
                    raise ValueError("Full car representative identities differ from fresh authoritative inputs")
                return fresh
            finally:
                probe.end_production_scope("representative", Path(scratch), success=False)
                QgsProject.instance().clear()

    def end_production_scope(self, scope, output_dir, *, success):
        super().end_production_scope(scope, output_dir, success=success)
        self._font_family = None
        self._shared_ground = None
        from qgis.core import QgsProject
        QgsProject.instance().clear()

    @staticmethod
    def visual_spot_check_outputs(outputs):
        # Review the representative contrasts and every department label/scale;
        # the selections and labels come from this run's actual output inventory.
        return [row for row in outputs if row["territory"]["kind"] in {"departement", "region", "epci"}
                or (row["territory"]["kind"], row["territory"]["code"]) in TERRITORIES]

    def preflight(self, recipe, binding):
        import numpy as np
        import pyarrow.parquet as pq
        self._facts_hashes.clear()
        self._production_sources = None
        if binding.family != "aedar" or recipe.name != aedar_car_recipe().name:
            raise ValueError("Car production requires the AEDAR car-diversity contract")
        features = [f for rows in binding.map_set.layers.values() for f in rows]
        for feature in features:
            if (feature["mode"] != "car" or feature.get("source_mode", "car") != "car" or
                    feature["measure"] != "diversity" or feature["horizon"] != HORIZON or
                    feature["value_field"] != f"diversity_car_{HORIZON}" or
                    feature.get("comparison") != "car-only-typequ" or
                    feature.get("scale_type") != "equal-width" or
                    feature.get("scale_cap") != LOSS_SCALE_MAX or feature.get("scale_overflow") is not False or
                    tuple(feature["scale_breaks"]) != tuple(LOSS_SCALE_MAX * i / 5 for i in range(6))):
                raise ValueError("Car production requires the reviewed 15-minute absolute-diversity scale")
        for path in {f["facts_path"] for f in features}:
            parquet = pq.ParquetFile(path)
            required = {"code_insee", "cle_interop_adr", "lon", "lat", f"diversity_car_{HORIZON}"}
            if not parquet.metadata.num_rows or required - set(parquet.schema_arrow.names):
                raise ValueError("Car production requires complete prepared address facts")
            # Read only the car contract. A consolidated facts snapshot may also
            # contain loss columns, but they play no part in car production.
            table = parquet.read(columns=sorted(required))
            for field in required:
                if table[field].null_count:
                    raise ValueError(f"Invalid car facts: missing {field}")
            try:
                values = table[f"diversity_car_{HORIZON}"].to_numpy().astype(np.float64)
                coords = [table[field].to_numpy().astype(np.float64) for field in ("lon", "lat")]
            except (TypeError, ValueError) as error:
                raise ValueError("Invalid car facts: metrics and coordinates must be numeric") from error
            if (not np.all(np.isfinite(values)) or np.any(values < 0) or
                    np.any(values > LOSS_SCALE_MAX) or np.any(values != np.floor(values)) or
                    not all(np.all(np.isfinite(coord)) for coord in coords)):
                raise ValueError("Invalid car facts: finite reachable-type counts in 0–218 and coordinates required")
        self._binding = binding

    def input_identity(self):
        if self._production_sources is None:
            identity = super().input_identity()
            for source in identity["ocsge_ground_sources"]:
                source["sha256"] = _file_sha256(Path(source["path"]))
            communes = self.raw_dir / "communes_limites.geojson"
            identity["commune_frame_source"] = {"path": str(communes.resolve()),
                "sha256": _file_sha256(communes)}
            self._production_sources = identity
        return self._production_sources

    @staticmethod
    def output_contract(profile=None):
        return {**WEBP_ENCODING_CONTRACT,
                "dimensions": list(profile.size) if profile else {
                    "inspection": [2400, 2400], "inline": [900, 900]},
                "alpha": "lossless" if profile is None or profile.transparent_outside else "opaque-rgb"}

    @staticmethod
    def expected_output_path(feature, profile, output_dir):
        return Path(output_dir) / f"{feature['territory']['code']}-car-{profile.name}.webp"

    def save_output(self, image, feature, profile, output_dir):
        final = self.expected_output_path(feature, profile, output_dir)
        staged = final.with_name(f".{final.stem}-{uuid4().hex}.stage.webp")
        return encode_qimage(image, staged, preserve_alpha=profile.transparent_outside)

    @staticmethod
    def promote_output(staged_path, final_path):
        staged_path, final_path = Path(staged_path), Path(final_path)
        if staged_path.parent.resolve() != final_path.parent.resolve():
            raise ValueError("Staged and canonical car artifacts must share their output directory")
        os.replace(staged_path, final_path)
        return final_path

    @staticmethod
    def discard_output(staged_path):
        Path(staged_path).unlink(missing_ok=True)

    def validate(self, path, feature, profile):
        validate_webp(path, profile)

    def render_identity(self):
        root = Path(__file__).parent
        return {**super().render_identity(), "family": "aedar-car-production-v1",
                "production_sha256": _files_sha256(root, [root / "aedar_car.py", root / "webp_encoding.py"]),
                "canonical_encoding": self.output_contract()}

    def profile_identity(self, profile, feature=None, recipe=None):
        return {**super().profile_identity(profile, feature, recipe),
                "production_renderer": self.render_identity(), "encoding": self.output_contract(profile)}

    def effective_input_identity(self, feature, profile):
        identity = super().effective_input_identity(feature, profile)
        identity["territory_codes"] = tuple(sorted(feature["territory_codes"]))
        sources = self.input_identity()
        identity["commune_frame_source"] = sources["commune_frame_source"]
        if profile.furniture:
            identity["ocsge_ground_sources"] = sources["ocsge_ground_sources"]
            identity["content"] = {key: feature.get(key) for key in
                ("title_prefix", "title_mode", "helper", "legend_label")}
        return identity

    def drain_stage_report(self):
        rows = list(self._stage_report)
        # SharedGround holds this same list for frontier events; retain the
        # sink while draining so full runs cannot lose or accumulate diagnostics.
        self._stage_report.clear()
        return rows
