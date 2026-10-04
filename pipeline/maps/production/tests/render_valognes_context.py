"""Bounded region inspection regression proving acquired mainland at Valognes."""
from pathlib import Path
import sys
from qgis.core import (QgsApplication, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsProject,
                       QgsGeometry, QgsPointXY)

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).parents[1]))
from network import NetworkAdapter, build_representative_map_set, network_recipe
from runner import run_production

app = QgsApplication([], False)
app.initQgis()
try:
    raw = root / "pipeline/data/raw"
    binding = build_representative_map_set(raw)
    region = next(feature for feature in binding.map_set.layers["network-outputs"]
                  if feature["territory"]["kind"] == "region" and feature["mode"] == "car")
    binding = type(binding)(binding.family, type(binding.map_set)({"network-outputs": (region,)}))
    adapter = NetworkAdapter(raw)
    result = run_production(network_recipe(), binding, "representative", ("inspection",),
                            adapter, root / "pipeline/maps/production/output")
    valognes = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:4326"),
        QgsCoordinateReferenceSystem("EPSG:2154"), QgsProject.instance().transformContext()).transform(QgsPointXY(-1.4758, 49.5122))
    context = adapter._shared_ground.context_geometry
    assert context.contains(QgsGeometry.fromPointXY(valognes)), "Valognes mainland geometry missing from inspection ground"
    assert result.qa["status"] == "passed" and result.qa["artifact_count"] == 1
    print({"path": result.outputs[0]["path"], "sha256": result.outputs[0]["output_sha256"],
           "elapsed_seconds": result.qa["elapsed_seconds"], "stage_report": result.qa["stage_report"]})
finally:
    app.exitQgis()
