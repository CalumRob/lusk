"""Bounded Rennes inline-only run; context coverage must not require inspection acquisition."""
from pathlib import Path
import sys
from qgis.core import QgsApplication

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).parents[1]))
from network import NetworkAdapter, build_representative_map_set, network_recipe
from runner import run_production

app = QgsApplication([], False)
app.initQgis()
try:
    raw = root / "pipeline/data/raw"
    binding = build_representative_map_set(raw)
    feature = next(item for item in binding.map_set.layers["network-outputs"]
                   if item["territory"]["code"] == "35238" and item["mode"] == "car")
    binding = type(binding)(binding.family, type(binding.map_set)({"network-outputs": (feature,)}))
    result = run_production(network_recipe(), binding, "representative", ("inline",),
        NetworkAdapter(raw), root / "pipeline/maps/production/output")
    output = result.outputs[0]
    print({"path": output["path"], "decision": output["decision"],
           "sha256": output["output_sha256"], "elapsed_seconds": result.qa["elapsed_seconds"],
           "preparation_seconds": result.qa["preparation_seconds"]})
finally:
    app.exitQgis()
