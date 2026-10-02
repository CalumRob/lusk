from pathlib import Path
import sys
from qgis.core import QgsApplication
from qgis.PyQt.QtGui import QImage
from qgis.core import QgsGeometry, QgsPointXY, QgsRectangle

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).parents[1]))
from network import NetworkAdapter, build_representative_map_set, network_recipe
from runner import run_production

app = QgsApplication([], False)
app.initQgis()
try:
    raw = root / "pipeline/data/raw"
    binding = build_representative_map_set(raw)
    feature = next(f for f in binding.map_set.layers["network-outputs"]
                   if f["territory"]["code"] == "35238" and f["mode"] == "car")
    binding = type(binding)(binding.family, type(binding.map_set)({"network-outputs": (feature,)}))
    result = run_production(network_recipe(), binding, "representative", ("inspection", "inline"),
                            NetworkAdapter(raw), root / "pipeline/maps/production/output")
    assert result.qa["artifact_count"] == 2
    assert {item["profile"] for item in result.outputs} == {"inspection", "inline"}
    # These inspection reference pixels were sampled from the approved
    # prototype image (SHA-256 17fc95c4f2afe90ae52f36106c18eb700c43d064d22f22d52ec1c4cbda97b86e).
    # They exercise paper/context, the mode-title engraving, the territory
    # label, and the source prototype's white footer through run_production().
    inspection = QImage(str(root / "pipeline/maps/production/output/35238-car-inspection.png"))
    for point, expected in {
        (0, 0): (204, 204, 204),
        (500, 160): (112, 122, 121),
        (150, 390): (87, 114, 111),
        (100, 3130): (255, 255, 255),
    }.items():
        actual = inspection.pixelColor(*point)
        assert max(abs(actual.red() - expected[0]), abs(actual.green() - expected[1]),
                   abs(actual.blue() - expected[2])) <= 12, (point, actual.name(), expected)

    inline = QImage(str(root / "pipeline/maps/production/output/35238-car-inline.png"))
    extent = QgsRectangle(feature["extent"])
    inside = feature["analytical_geometry"].pointOnSurface().asPoint()
    inside_x = round((inside.x() - extent.xMinimum()) / extent.width() * inline.width())
    inside_y = round((extent.yMaximum() - inside.y()) / extent.height() * inline.height())
    outside = QgsPointXY(extent.xMinimum() + extent.width() * 0.01,
                         extent.yMaximum() - extent.height() * 0.01)
    assert not feature["analytical_geometry"].contains(QgsGeometry.fromPointXY(outside))
    outside_x, outside_y = round(inline.width() * .01), round(inline.height() * .01)
    assert inline.pixelColor(inside_x, inside_y).alpha() == 255
    assert inline.pixelColor(outside_x, outside_y).alpha() == 0
    print(result)
finally:
    app.exitQgis()
