import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))


class CartographicPolicyTests(unittest.TestCase):
    def test_native_parity_gate_requires_six_unique_exact_references(self):
        from proof_issue772_native import EXPECTED_NATIVE_REFERENCES, validate_native_parity
        records = [dict(family=family, profile=profile, file=name, sha256=digest)
                   for (family, profile, name), digest in EXPECTED_NATIVE_REFERENCES.items()]
        records.append(dict(family="other", profile="inspection", file="qa.webp", sha256="x"))
        self.assertTrue(validate_native_parity(records))
        for invalid in (records[1:],
                        [dict(row, sha256="bad") if row is records[0] else row for row in records],
                        [*records, records[0]]):
            with self.subTest(records=len(invalid)), self.assertRaises(ValueError):
                validate_native_parity(invalid)

    def test_shared_policy_drives_network_and_historical_aedar_recipes_and_frame(self):
        from cartographic_policy import SHARED_CARTOGRAPHIC_POLICY
        from network import network_recipe, _map_extent
        from aedar_maps import aedar_recipe, aedar_loss_recipe
        from qgis.core import QgsGeometry, QgsPointXY

        recipes = (network_recipe(), aedar_recipe(), aedar_loss_recipe())
        for recipe in recipes:
            self.assertEqual(recipe.foundation.framing, SHARED_CARTOGRAPHIC_POLICY.framing())
            self.assertEqual(recipe.foundation.ground["inspection_surface"], "ocsge-selected-cs")
            self.assertEqual(recipe.foundation.ground["water"], "sea-colour")
        point = QgsGeometry.fromPointXY(QgsPointXY(0, 0)).buffer(2, 32)
        extent = _map_extent(point)
        self.assertAlmostEqual(extent.width(), 4 * (1 + SHARED_CARTOGRAPHIC_POLICY.frame_margin_ratio), places=6)

    def test_family_frame_override_is_local_and_validated(self):
        from cartographic_policy import SHARED_CARTOGRAPHIC_POLICY, family_policy
        from network import network_recipe, _map_extent
        from aedar_maps import _aedar_frame_extent
        from qgis.core import QgsGeometry, QgsPointXY

        network_config = {"cartographic_policy": {"frame_margin_ratio": 0.12}}
        aedar_config = {"family": "aedar", "geography_contract": "test",
                        "cartographic_policy": {"frame_margin_ratio": 0.12},
                        "cartography": {}}
        override = family_policy(network_config["cartographic_policy"])
        point = QgsGeometry.fromPointXY(QgsPointXY(0, 0)).buffer(2, 32)
        self.assertAlmostEqual(_aedar_frame_extent(point, override).width(), 4.48, places=6)
        self.assertAlmostEqual(_map_extent(point).width(), 4.32, places=6)
        self.assertEqual(network_recipe(network_config).foundation.framing["margin_ratio"], 0.12)
        self.assertEqual(network_recipe().foundation.framing["margin_ratio"], 0.08)
        from aedar_map_plan import selected_aedar_recipe
        self.assertEqual(selected_aedar_recipe(aedar_config).foundation.framing["margin_ratio"], 0.12)
        self.assertEqual(selected_aedar_recipe().foundation.framing["margin_ratio"], 0.08)
        self.assertEqual(SHARED_CARTOGRAPHIC_POLICY.frame_margin_ratio, 0.08)
        with self.assertRaises(ValueError):
            family_policy({"title": "not a physical policy"})

    def test_selected_recipe_is_not_historically_named_or_composed(self):
        from aedar_map_plan import selected_aedar_recipe
        from aedar_maps import aedar_loss_recipe

        selected, historical = selected_aedar_recipe(), aedar_loss_recipe()
        self.assertEqual(selected.name, "aedar-selected-static")
        self.assertNotEqual(selected.foundation.composition, historical.foundation.composition)
        self.assertEqual(historical.name, "aedar-address-equipment-loss-exploration")

    def test_profile_contracts_bind_shared_policy_but_isolate_family_profile_composition(self):
        from dataclasses import replace
        from runner import Foundation, Recipe, PROFILES, _effective_identity_for
        from cartographic_policy import SHARED_CARTOGRAPHIC_POLICY

        class Adapter:
            def render_identity(self):
                return {"renderer": "contract-test"}

        adapter = Adapter()
        recipe = Recipe("fixture", 1, Foundation("f1", framing={"margin_ratio": 0.08},
            composition={"inspection": {"legend": "a"}, "inline": {"shadow": "shared"}},
            cartographic_policy=SHARED_CARTOGRAPHIC_POLICY), "fixture")
        feature = {"territory": {"kind": "commune", "code": "1", "name": "Test"},
                   "mode": "fixture", "geometry": "stable-geometry"}
        renderer = adapter.render_identity()
        base_inline = _effective_identity_for(recipe, adapter, renderer, feature, PROFILES["inline"])
        changed_shared = replace(recipe, foundation=replace(recipe.foundation,
            framing={"margin_ratio": 0.09}))
        self.assertNotEqual(base_inline, _effective_identity_for(changed_shared, adapter,
            renderer, feature, PROFILES["inline"]))
        changed_inspection_only = replace(recipe, foundation=replace(recipe.foundation,
            composition={"inspection": {"legend": "b"}, "inline": {"shadow": "shared"}}))
        self.assertEqual(base_inline, _effective_identity_for(changed_inspection_only, adapter,
            renderer, feature, PROFILES["inline"]))
        self.assertNotEqual(_effective_identity_for(recipe, adapter, renderer, feature,
            PROFILES["inspection"]), _effective_identity_for(changed_inspection_only, adapter,
            renderer, feature, PROFILES["inspection"]))
        from cartographic_policy import CartographicPolicy
        base_inspection = _effective_identity_for(recipe, adapter, renderer, feature,
            PROFILES["inspection"])
        changed_inline_surface = replace(recipe, foundation=replace(recipe.foundation,
            cartographic_policy=CartographicPolicy(inline_surface="alternate-paper")))
        self.assertEqual(base_inspection, _effective_identity_for(changed_inline_surface, adapter,
            renderer, feature, PROFILES["inspection"]))
        self.assertNotEqual(base_inline, _effective_identity_for(changed_inline_surface, adapter,
            renderer, feature, PROFILES["inline"]))
