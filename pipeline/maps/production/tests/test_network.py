"""QGIS-backed tests for shared network preparation; run with QGIS Python."""
import gc
import json
import shutil
import tempfile
import unittest
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor, QImage

sys.path.insert(0, str(Path(__file__).parents[1]))

from qgis.core import (  # noqa: E402
    QgsApplication,
    QgsExpression,
    QgsExpressionContext,
    QgsFeature,
    QgsFeatureRequest,
    QgsGeometry,
    QgsPointXY,
    QgsProject,
    QgsRectangle,
    QgsVectorLayer,
    QgsVectorDataProvider,
    QgsVectorFileWriter,
)

from map_ground import add_context_land  # noqa: E402
from network import (  # noqa: E402
    _build_geovelo_cache,
    _build_osm_cache,
    _new_flatgeobuf_writer,
    _validate_flatgeobuf,
    _walking_filter_sql,
    car_filter_sql,
    prepare_osm_layers,
    prepare_network_cache,
)


class CountingSource:
    """Expose a tiny in-memory provider while counting scan/filter operations."""

    def __init__(self, layer):
        self.layer = layer
        self.scans = 0
        self.subsets = []
        self.subset_update_flags = []

    def dataProvider(self):
        return self

    def fields(self):
        return self.layer.fields()

    def crs(self):
        return self.layer.crs()

    def setSubsetString(self, expression, updateFeatureCount=True):
        self.subsets.append(expression)
        self.subset_update_flags.append(updateFeatureCount)
        return True

    def getFeatures(self, request=None):
        self.scans += 1
        return self.layer.getFeatures(request)


class NetworkPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dirs = []
        cls.app = QgsApplication([], False)
        cls.app.initQgis()

    @classmethod
    def tearDownClass(cls):
        cls.app.exitQgis()
        gc.collect()
        for directory in cls.fixture_dirs:
            shutil.rmtree(directory, ignore_errors=True)

    def test_car_and_walking_networks_are_classified_from_one_osm_scan(self):
        project = QgsProject.instance()
        project.clear()
        source_layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "OSM fixture",
            "memory",
        )
        cases = (
            ("primary", None),
            ("footway", None),
            ("residential", '"sidewalk"=>"yes"'),
            ("primary", '"access"=>"no"'),
            ("living_street", None),
        )
        features = []
        for index, (highway, tags) in enumerate(cases):
            feature = QgsFeature(source_layer.fields())
            feature.setAttributes([highway, tags])
            feature.setGeometry(QgsGeometry.fromPolylineXY([
                QgsPointXY(index * 10, 0), QgsPointXY(index * 10 + 5, 5)
            ]))
            features.append(feature)
        source_layer.dataProvider().addFeatures(features)
        source_layer.updateExtents()
        source = CountingSource(source_layer)

        targets = prepare_osm_layers(
            project,
            source,
            ("car", "walk"),
            {"car": "#123456", "walk": "#654321"},
        )

        self.assertEqual(source.scans, 1)
        self.assertEqual(len(source.subsets), 1)
        self.assertEqual(source.subset_update_flags, [False])
        self.assertIn(car_filter_sql(), source.subsets[0])
        self.assertIn(_walking_filter_sql(include_speed=True), source.subsets[0])
        self.assertEqual({mode: layer.featureCount() for mode, layer in targets.items()}, {
            "car": 3,
            "walk": 3,
        })
        self.assertTrue(all(
            layer.dataProvider().hasSpatialIndex() == QgsVectorDataProvider.SpatialIndexPresent
            for layer in targets.values()
        ))

    def test_tag_classifier_matches_the_approved_osm_filter_expressions(self):
        from network import _classify_osm_modes

        source_layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "OSM classifier fixture",
            "memory",
        )
        cases = [
            ("primary", None),
            ("footway", None),
            ("residential", '"sidewalk"=>"yes"'),
            ("primary", '"maxspeed"=>"30"'),
            ("primary", '"maxspeed"=>"31"'),
            ("primary", '"foot"=>"designated"'),
            ("residential", '"foot"=>"no"'),
            ("path", '"access"=>"private"'),
            ("service", '"service"=>"driveway"'),
            ("secondary", '"busway"=>"designated"'),
            ("primary", '"access"=>"NO"'),
        ]
        cases.extend(("primary", marker) for marker in (
            '"access"=>"no"', '"access"=>"private"', '"access"=>"customers"',
            '"access"=>"restricted"', '"access"=>"permit"', '"access"=>"emergency"',
            '"access"=>"psv"', '"vehicle"=>"no"', '"vehicle"=>"private"',
            '"vehicle"=>"customers"', '"vehicle"=>"restricted"', '"vehicle"=>"permit"',
            '"vehicle"=>"emergency"', '"vehicle"=>"service"', '"motor_vehicle"=>"no"',
            '"motor_vehicle"=>"private"', '"motor_vehicle"=>"customers"',
            '"motor_vehicle"=>"restricted"', '"motor_vehicle"=>"permit"',
            '"motor_vehicle"=>"emergency"', '"motor_vehicle"=>"agricultural"',
            '"motor_vehicle"=>"delivery"', '"motor_vehicle"=>"forestry"',
            '"motorcar"=>"no"', '"motorcar"=>"private"', '"motorcar"=>"customers"',
            '"motorcar"=>"restricted"', '"motorcar"=>"permit"', '"motorcar"=>"emergency"',
            '"service"=>"parking_aisle"', '"service"=>"driveway"',
            '"service"=>"drive-through"', '"service"=>"emergency_access"',
            '"service"=>"bus"', '"service"=>"voie_de_bus"',
            '"busway"=>"designated"', '"busway"=>"track"',
        ))
        cases.extend(("footway", marker) for marker in (
            '"foot"=>"no"', '"foot"=>"private"', '"access"=>"no"',
            '"access"=>"private"', '"access"=>"customers"', '"access"=>"restricted"',
        ))

        expressions = {
            "car": QgsExpression(car_filter_sql()),
            "walk": QgsExpression(_walking_filter_sql(include_speed=True)),
        }
        context = QgsExpressionContext()
        context.setFields(source_layer.fields())
        for expression in expressions.values():
            self.assertTrue(expression.prepare(context), expression.parserErrorString())

        for highway, tags in cases:
            with self.subTest(highway=highway, tags=tags):
                feature = QgsFeature(source_layer.fields())
                feature.setAttributes([highway, tags])
                context.setFeature(feature)
                expected = tuple(bool(expression.evaluate(context))
                                 for expression in expressions.values())
                matches = _classify_osm_modes(feature, ("car", "walk"))
                actual = tuple(mode in matches for mode in expressions)
                self.assertEqual(actual, expected)

    def test_prepared_flatgeobuf_is_readable_and_spatially_indexed(self):
        project = QgsProject.instance()
        project.clear()
        with TemporaryDirectory() as directory:
            path = Path(directory) / "network.fgb"
            writer = _new_flatgeobuf_writer(path, project.transformContext())
            for x in (0, 100):
                feature = QgsFeature()
                geometry = QgsGeometry.fromPolylineXY([
                    QgsPointXY(x, 0), QgsPointXY(x + 5, 5)
                ])
                geometry.convertToMultiType()
                feature.setGeometry(geometry)
                self.assertTrue(writer.addFeature(feature))
            writer.finalize()
            del writer

            _validate_flatgeobuf({"fixture": path}, "fixture")
            layer = QgsVectorLayer(str(path), "prepared fixture", "ogr")
            selected = list(layer.getFeatures(
                QgsFeatureRequest().setFilterRect(QgsRectangle(-1, -1, 10, 10))
            ))
            selected_count = len(selected)
            feature_count = layer.featureCount()
            del layer
            del selected
            gc.collect()

        self.assertEqual(selected_count, 1)
        self.assertEqual(feature_count, 2)

    def test_osm_cache_builder_streams_both_modes_into_indexed_layers(self):
        project = QgsProject.instance()
        project.clear()
        source_layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "OSM source fixture",
            "memory",
        )
        cases = (
            ("primary", None),
            ("footway", None),
            ("residential", '"sidewalk"=>"yes"'),
            ("primary", '"access"=>"no"'),
            ("living_street", None),
        )
        features = []
        for index, (highway, tags) in enumerate(cases):
            feature = QgsFeature(source_layer.fields())
            feature.setAttributes([highway, tags])
            feature.setGeometry(QgsGeometry.fromPolylineXY([
                QgsPointXY(index * 10, 0), QgsPointXY(index * 10 + 5, 5)
            ]))
            features.append(feature)
        source_layer.dataProvider().addFeatures(features)
        source_layer.updateExtents()

        root = Path(tempfile.mkdtemp())
        self.__class__.fixture_dirs.append(root)
        project_file = self._write_gpkg(source_layer, project, root / "source.gpkg", "lines")
        source_mtime_ns = project_file.stat().st_mtime_ns
        cache_dir = root / "cache"
        cache_dir.mkdir()
        _build_osm_cache(cache_dir, project_file, project)
        self.assertEqual(
            project_file.stat().st_mtime_ns,
            source_mtime_ns,
            "preparing the cache must not write to the authoritative OSM source",
        )
        car = QgsVectorLayer(str(cache_dir / "osm-car.fgb"), "car fixture", "ogr")
        walk = QgsVectorLayer(str(cache_dir / "osm-walk.fgb"), "walk fixture", "ogr")
        self.assertTrue(car.isValid())
        self.assertTrue(walk.isValid())
        car_count = car.featureCount()
        walk_count = walk.featureCount()
        car_index = car.dataProvider().hasSpatialIndex()
        walk_index = walk.dataProvider().hasSpatialIndex()
        del car
        del walk
        gc.collect()
        self.assertEqual(car_count, 3)
        self.assertEqual(walk_count, 3)
        self.assertEqual(car_index, QgsVectorDataProvider.SpatialIndexPresent)
        self.assertEqual(walk_index, QgsVectorDataProvider.SpatialIndexPresent)

    def test_geovelo_cache_builder_preserves_existing_classification_priority(self):
        project = QgsProject.instance()
        project.clear()
        source_layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=ame_d:string&field=ame_g:string",
            "Geovelo source fixture",
            "memory",
        )
        cases = (
            (None, "PISTE CYCLABLE"),
            ("AUCUN", "BANDE CYCLABLE"),
            ("VOIE VERTE", "BANDE CYCLABLE"),
            ("UNMAPPED", "PISTE CYCLABLE"),
            (None, None),
        )
        features = []
        for index, (ame_d, ame_g) in enumerate(cases):
            feature = QgsFeature(source_layer.fields())
            feature.setAttributes([ame_d, ame_g])
            feature.setGeometry(QgsGeometry.fromPolylineXY([
                QgsPointXY(index * 10, 0), QgsPointXY(index * 10 + 5, 5)
            ]))
            features.append(feature)
        source_layer.dataProvider().addFeatures(features)
        source_layer.updateExtents()

        root = Path(tempfile.mkdtemp())
        self.__class__.fixture_dirs.append(root)
        project_file = self._write_gpkg(source_layer, project, root / "source.gpkg", "geovelo")
        source_mtime_ns = project_file.stat().st_mtime_ns
        cache_dir = root / "cache"
        cache_dir.mkdir()
        _build_geovelo_cache(cache_dir, project_file, project)
        self.assertEqual(
            project_file.stat().st_mtime_ns,
            source_mtime_ns,
            "preparing the cache must not write to the authoritative Geovelo source",
        )
        protected = QgsVectorLayer(
            str(cache_dir / "geovelo-bike-protected.fgb"), "protected fixture", "ogr"
        )
        shared = QgsVectorLayer(
            str(cache_dir / "geovelo-bike-shared.fgb"), "shared fixture", "ogr"
        )
        self.assertTrue(protected.isValid())
        self.assertTrue(shared.isValid())
        protected_count = protected.featureCount()
        shared_count = shared.featureCount()
        del protected
        del shared
        gc.collect()
        self.assertEqual(protected_count, 2)
        self.assertEqual(shared_count, 1)

    def test_cache_preparation_binds_each_family_to_its_own_source_path(self):
        project = QgsProject.instance()
        project.clear()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            osm_path = raw_dir / "bretagne-latest.gpkg"
            geovelo_path = raw_dir / "france-20260807.parquet"
            osm_path.write_bytes(b"osm source placeholder")
            geovelo_path.write_bytes(b"geovelo source placeholder")

            def build_caches(cache_root, preparations, *, force=False, report=None):
                for family, preparation in preparations.items():
                    preparation.build(root / f"built-{family}")
                return {}

            with (
                patch("network.prepare_network_source_families", side_effect=build_caches),
                patch("network._build_osm_cache") as build_osm,
                patch("network._build_geovelo_cache") as build_geovelo,
            ):
                prepare_network_cache(raw_dir, project, root / "cache")

            build_osm.assert_called_once_with(root / "built-osm", osm_path, project)
            build_geovelo.assert_called_once_with(root / "built-geovelo", geovelo_path, project)

    def _write_gpkg(self, layer, project, path, layer_name):
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GPKG"
        options.layerName = layer_name
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, str(path), project.transformContext(), options
        )
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)
        return path

    def test_network_scope_comes_from_family_config_not_shared_foundation(self):
        from network import (
            NetworkAdapter,
            build_full_map_set,
            build_representative_map_set,
            network_recipe,
        )

        project = QgsProject.instance()
        project.clear()
        recipe = network_recipe()
        adapter = NetworkAdapter("unused")
        self.assertNotIn("analytical_departments", recipe.foundation.geography)
        self.assertEqual(
            adapter.family_config["scope"]["analytical_departments"],
            ["22", "29", "35", "56"],
        )
        renderer_identity = adapter.render_identity()
        self.assertRegex(renderer_identity["code_assets_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            set(renderer_identity["runtime"]), {"qgis", "qt", "pyqt", "python"}
        )

        root = Path(tempfile.mkdtemp(prefix="lusk-network-scope-"))
        self.__class__.fixture_dirs.append(root)
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline" / "inst" / "extdata"
        metadata.mkdir(parents=True)
        (metadata / "epci_geo_api.json").write_text(
            json.dumps({"labels": [{"code": "243500741", "nom": "Redon"}]}),
            encoding="utf-8",
        )
        communes = QgsVectorLayer(
            "MultiPolygon?crs=EPSG:2154"
            "&field=code_insee:string&field=nom_officiel:string"
            "&field=code_insee_du_departement:string"
            "&field=code_insee_de_la_region:string"
            "&field=codes_siren_des_epci:string",
            "scope fixture",
            "memory",
        )
        cases = (
            ("35238", "Rennes", "35", "53", "", 0),
            ("22001", "Inside selected scope", "22", "53", "243500741", 20),
            ("44001", "Outside Bretagne", "44", "52", "243500741", 40),
        )
        features = []
        for code, name, department, region, epcis, left in cases:
            feature = QgsFeature(communes.fields())
            feature.setAttributes([code, name, department, region, epcis])
            geometry = QgsGeometry.fromWkt(
                f"POLYGON (({left} 0,{left+10} 0,{left+10} 10,{left} 10,{left} 0))"
            )
            geometry.convertToMultiType()
            feature.setGeometry(geometry)
            features.append(feature)
        self.assertTrue(communes.dataProvider().addFeatures(features))
        communes.updateExtents()
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GeoJSON"
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            communes, str(raw / "communes_limites.geojson"),
            project.transformContext(), options,
        )
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)

        family_config = {"scope": {"analytical_departments": ["22"]}}
        binding = build_representative_map_set(raw, project, family_config=family_config)

        bound = binding.map_set.layers["network-outputs"]
        region = next(item for item in bound if item["territory"]["kind"] == "region")
        epci = next(item for item in bound if item["territory"]["kind"] == "epci")
        self.assertAlmostEqual(region["geometry"].boundingBox().xMinimum(), 20)
        self.assertAlmostEqual(region["geometry"].boundingBox().xMaximum(), 30)
        self.assertAlmostEqual(epci["analytical_geometry"].boundingBox().xMaximum(), 30)
        self.assertAlmostEqual(epci["geometry"].boundingBox().xMaximum(), 50)

    def test_full_inventory_is_derived_from_authoritative_communes_and_pinned_epci_metadata(self):
        from network import NetworkAdapter, build_full_map_set
        from runner import Binding, MapSet
        project = QgsProject.instance()
        project.clear()
        root = Path(tempfile.mkdtemp(prefix="lusk-full-inventory-"))
        self.__class__.fixture_dirs.append(root)
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline" / "inst" / "extdata"
        metadata.mkdir(parents=True)
        (metadata / "epci_geo_api.json").write_text(json.dumps({"labels": [
            {"code": "epci-a", "nom": "A"}, {"code": "epci-b", "nom": "B"}]}), encoding="utf-8")
        communes = QgsVectorLayer(
            "MultiPolygon?crs=EPSG:2154&field=code_insee:string&field=nom_officiel:string"
            "&field=code_insee_du_departement:string&field=code_insee_de_la_region:string"
            "&field=codes_siren_des_epci:string", "inventory fixture", "memory")
        rows = (("22001", "One", "22", "53", "epci-a", 0),
                ("22002", "Two", "22", "53", "epci-a/epci-b", 20),
                ("29001", "Outside analytical department", "29", "53", "epci-b", 40))
        features = []
        for code, name, department, region, epcis, x in rows:
            feature = QgsFeature(communes.fields())
            feature.setAttributes([code, name, department, region, epcis])
            geometry = QgsGeometry.fromWkt(
                f"POLYGON (({x} 0,{x+10} 0,{x+10} 10,{x} 10,{x} 0))")
            geometry.convertToMultiType()
            feature.setGeometry(geometry)
            features.append(feature)
        communes.dataProvider().addFeatures(features)
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GeoJSON"
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            communes, str(raw / "communes_limites.geojson"), project.transformContext(), options)
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)
        binding = build_full_map_set(raw, project,
            family_config={"scope": {"analytical_departments": ["22"]}})
        adapter = NetworkAdapter(raw)
        adapter.family_config = {"scope": {"analytical_departments": ["22"]}}
        adapter.preflight_scope(None, binding, "full", ("inspection", "inline"))
        items = binding.map_set.layers["network-outputs"]
        territories = {(item["territory"]["kind"], item["territory"]["code"])
                       for item in items}
        self.assertEqual(territories, {("commune", "22001"), ("commune", "22002"),
            ("epci", "epci-a"), ("epci", "epci-b"), ("departement", "22"), ("region", "53")})
        self.assertEqual(len(items), len(territories) * len({item["mode"] for item in items}))
        epci_b = next(item for item in items if item["territory"]["code"] == "epci-b")
        self.assertEqual(epci_b["geometry"].boundingBox().xMaximum(), 50)
        self.assertEqual(epci_b["analytical_geometry"].boundingBox().xMaximum(), 30)
        incomplete = Binding("network", MapSet({"network-outputs": items[:-1]}))
        with self.assertRaisesRegex(ValueError, "does not cover exactly"):
            adapter.preflight_scope(None, incomplete, "full", ("inspection", "inline"))

    def test_real_network_adapter_recomputes_paired_current_review_identities(self):
        from dataclasses import replace
        from network import NetworkAdapter, network_recipe
        from runner import Binding, MapSet, PROFILES
        project = QgsProject.instance()
        project.clear()
        adapter = NetworkAdapter(Path(__file__).parents[3] / "data" / "raw")
        features = []
        for kind, code in (("commune", "35238"), ("region", "53"),
                           ("epci", "243500741")):
            for mode in ("car", "walk", "bike"):
                geometry = QgsGeometry.fromRect(QgsRectangle(0, 0, 10, 10))
                features.append({"territory": {"kind": kind, "code": code, "name": code},
                    "mode": mode, "geometry": geometry, "analytical_geometry": geometry,
                    "extent": QgsRectangle(0, 0, 10, 10)})
        binding = Binding("network", MapSet({"network-outputs": features}))
        adapter.effective_input_identity = lambda feature, profile: {"visible": feature["mode"]}
        recipe = network_recipe()
        current = adapter.current_approval_members(recipe, binding,
            ("inspection", "inline"), adapter.render_identity())
        changed_recipe = replace(recipe, foundation=replace(recipe.foundation,
            composition={**recipe.foundation.composition,
                "inline": {"shadow": "changed-profile-rule"}}))
        changed = adapter.current_approval_members(changed_recipe, binding,
            ("inspection", "inline"), adapter.render_identity())
        self.assertEqual(len(current), len(features) * len(PROFILES))
        by_profile = {name: {item[4] for item in current if item[3] == name}
                      for name in ("inspection", "inline")}
        changed_by_profile = {name: {item[4] for item in changed if item[3] == name}
                              for name in ("inspection", "inline")}
        self.assertEqual(by_profile["inspection"], changed_by_profile["inspection"])
        self.assertNotEqual(by_profile["inline"], changed_by_profile["inline"])

    def test_network_adapter_approval_seam_prepares_only_representative_binding(self):
        from network import NetworkAdapter, network_recipe
        full_binding, representative_binding = object(), object()
        adapter = NetworkAdapter(Path(__file__).parents[3] / "data" / "raw")
        output_root = Path.cwd() / "fixture-production-output"
        identities = [("commune", "35238", "car", "inline", "a" * 64)]
        with (patch("network.build_representative_map_set", return_value=representative_binding),
              patch.object(adapter, "prepare_run") as prepare,
              patch.object(adapter, "current_approval_members", return_value=identities)):
            result = adapter.prepare_current_approval_members(network_recipe(), full_binding,
                ("inspection", "inline"), {"renderer": "fixture"}, output_root)
        self.assertEqual(result, identities)
        self.assertIs(prepare.call_args.args[1], representative_binding)
        self.assertIsNot(prepare.call_args.args[1], full_binding)
        self.assertNotEqual(prepare.call_args.args[3], output_root)
        self.assertEqual(prepare.call_args.kwargs["context_cache_root"],
                         output_root / ".stage-cache" / "official-context")

    def test_post_batch_visual_review_selection_is_family_metadata_owned(self):
        from network import NetworkAdapter
        adapter = NetworkAdapter(Path(__file__).parents[3] / "data" / "raw")
        outputs = []
        for kind, code, mode in (("epci", "243500741", "car"),
                                 ("epci", "243500741", "bike"),
                                 ("region", "53", "car")):
            for profile in ("inspection", "inline"):
                outputs.append({"territory": {"kind": kind, "code": code},
                    "mode": mode, "profile": profile, "path": f"{kind}-{mode}-{profile}.png",
                    "effective_identity": "a" * 64, "output_sha256": "b" * 64})
        selected = adapter.visual_spot_check_outputs(outputs)
        self.assertEqual({(item["territory"]["kind"], item["mode"], item["profile"])
                          for item in selected}, {
            ("epci", "car", "inspection"), ("epci", "car", "inline"),
            ("epci", "bike", "inline"), ("region", "car", "inspection"),
            ("region", "car", "inline")})

    def test_land_context_uses_selected_communes_from_local_admin_express(self):
        project = QgsProject.instance()
        project.clear()
        communes = QgsVectorLayer(
            "MultiPolygon?crs=EPSG:2154&field=code_insee_du_departement:string",
            "local Admin Express fixture",
            "memory",
        )
        cases = (("22", 0), ("14", 20), ("99", 40))
        features = []
        for department, left in cases:
            feature = QgsFeature(communes.fields())
            feature.setAttributes([department])
            feature.setGeometry(QgsGeometry.fromWkt(
                f"POLYGON (({left} 0, {left+10} 0, {left+10} 10, {left} 10, {left} 0))"
            ))
            features.append(feature)
        communes.dataProvider().addFeatures(features)
        communes.updateExtents()

        _, land, _ = add_context_land(project, QgsRectangle(-1, -1, 31, 11), communes)

        self.assertTrue(land.contains(QgsGeometry.fromPointXY(QgsPointXY(5, 5))))
        self.assertTrue(land.contains(QgsGeometry.fromPointXY(QgsPointXY(25, 5))))
        self.assertFalse(land.contains(QgsGeometry.fromPointXY(QgsPointXY(45, 5))))

    def test_ground_preparation_reuses_exact_frontier_across_territories_and_sizes(self):
        import map_ground

        project = QgsProject.instance()
        project.clear()
        land = QgsGeometry.fromRect(QgsRectangle(0, 0, 100, 100))
        region = QgsGeometry.fromRect(QgsRectangle(0, 0, 50, 100))
        context_layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154", "land fixture", "memory")
        map_ground.replace_memory_geometry(context_layer, land)
        texture = QImage(10, 10, QImage.Format_RGBA8888)
        texture.fill(QColor("white"))
        shared = map_ground.SharedGround(context_layer, land, (), texture)
        expected = map_ground._frontier_geometry(region, land)

        with patch("map_ground._frontier_geometry", wraps=map_ground._frontier_geometry) as frontier:
            for code, extent in (("a", QgsRectangle(0, 0, 40, 40)),
                                 ("b", QgsRectangle(10, 10, 60, 60))):
                geometry = QgsGeometry.fromRect(extent)
                feature = {
                    "territory": {"kind": "commune", "code": code},
                    "analytical_geometry": geometry,
                    "geometry": geometry,
                    "region_geometry": QgsGeometry(region),
                    "extent": extent,
                }
                for size in (32, 48):
                    prepared = map_ground.prepare_ground(project, feature, size, shared)
                    self.assertEqual(prepared.ground.width(), size)
            self.assertEqual(frontier.call_count, 1)
            self.assertEqual(shared.frontier_for(region).asWkb(), expected.asWkb())
            changed = QgsGeometry.fromRect(QgsRectangle(0, 0, 60, 100))
            shared.frontier_for(changed)
            self.assertEqual(frontier.call_count, 2)
            # A new run must not inherit context-dependent frontier geometry.
            map_ground.SharedGround(context_layer, land, (), texture).frontier_for(region)
            self.assertEqual(frontier.call_count, 3)

    def test_inline_geometry_qa_prepares_queries_and_still_rejects_bad_masks(self):
        from map_ground import apply_inline_mask
        from network import NetworkAdapter
        from runner import PROFILES

        geometry = QgsGeometry.fromWkt(
            "MULTIPOLYGON (((20 20,80 20,80 80,20 80,20 20),"
            "(40 40,40 60,60 60,60 40,40 40)),"
            "((85 25,95 25,95 35,85 35,85 25)))"
        )
        extent = QgsRectangle(0, 0, 100, 100)
        feature = {"analytical_geometry": geometry, "extent": extent}
        ground = QImage(900, 900, QImage.Format_RGBA8888)
        ground.fill(QColor("white"))
        border = QImage(900, 900, QImage.Format_RGBA8888)
        border.fill(Qt.transparent)
        image = apply_inline_mask(ground, border, geometry, extent)
        adapter = NetworkAdapter(Path(__file__).parents[3] / "data" / "raw")

        with TemporaryDirectory() as directory:
            path = Path(directory) / "inline.png"
            self.assertTrue(image.save(str(path), "PNG"))
            with patch("network.QgsGeometry.createGeometryEngine",
                       wraps=QgsGeometry.createGeometryEngine) as engine:
                adapter.validate(path, feature, PROFILES["inline"])
                self.assertEqual(engine.call_count, 2)

            for label, x, y, alpha, error in (
                ("interior", 288, 288, 0, "Inline interior"),
                ("exterior", 90, 90, 255, "shadow exceeds its opacity contract"),
                ("hole", 450, 450, 255, "shadow exceeds its opacity contract"),
            ):
                with self.subTest(label=label):
                    invalid = image.copy()
                    invalid.setPixelColor(x, y, QColor(255, 255, 255, alpha))
                    self.assertTrue(invalid.save(str(path), "PNG"))
                    with self.assertRaisesRegex(ValueError, error):
                        adapter.validate(path, feature, PROFILES["inline"])


if __name__ == "__main__":
    unittest.main()
