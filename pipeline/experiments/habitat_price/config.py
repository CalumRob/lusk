"""Configuration of the first Habitat price experiment (issue #736).

Every path is resolved from the repository root; nothing here writes outside
the experiment's private output directory (``pipeline/data/processed/
habitat-price``) or the committed ``evidence/`` directory.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

EXPERIMENT_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = EXPERIMENT_DIR.parents[1]
REPO_ROOT = PIPELINE_DIR.parent

RAW_DIR = PIPELINE_DIR / "data" / "raw"
PROCESSED_DIR = PIPELINE_DIR / "data" / "processed"
EXTRACT_DIR = PROCESSED_DIR / "habitat-price" / "extract"
PRIVATE_DIR = PROCESSED_DIR / "habitat-price" / "private"
EVIDENCE_DIR = EXPERIMENT_DIR / "evidence"

# --- Observation contract -------------------------------------------------
DEPARTEMENTS = ("22", "29", "35", "56")
SALE_YEARS = (2022, 2023, 2024)
HOLDOUT_YEAR = 2024
NATURE_VENTE = "Vente"
LOG_BASE = "natural"

# --- AEDAR starter (owner-approved replacement for gamme scores) ----------
AEDAR_TYPES = {
    "A129": "MAIRIE",
    "B105": "SUPERMARCHÉ ET MAGASIN MULTI-COMMERCE",
    "B302": "MAGASIN DE VÊTEMENTS",
}
AEDAR_HORIZON_MIN = 15
AEDAR_MODES = ("bike_lts2", "transit_p1", "car")

# --- Source files (relative to pipeline/data/raw) -------------------------
SOURCES = {
    "dvf_plus_native": "R53_Bretagne.zip",
    "aedar_bike_lts2": "address-bike-lts2-53-2026v1.parquet",
    "aedar_transit": "address-transit-53-2026v1.parquet",
    "aedar_car": "address-car-53-2026v1.parquet",
    "aedar_origin_spine": "aedar-origin-spine-car-53-2026v1.txt",
    "rp_1km_grid": "rp2021_carreaux_1km_gpkg.zip",
    "epci_membership": "epci_au_01-01-2025.zip",
    "communes_limites": "communes_limites.geojson",
    "bpe_typequ_registry": "BPE25_liste_hierarchisee_TYPEQU.html",
    "sitadel_22": "sitadel_logements_communes_D22_2021-2023_2026-09.csv",
    "sitadel_29": "sitadel_logements_communes_D29_2021-2023_2026-09.csv",
    "sitadel_35": "sitadel_logements_communes_D35_2021-2023_2026-09.csv",
    "sitadel_56": "sitadel_logements_communes_D56_2021-2023_2026-09.csv",
    "rp_logements_2023": "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip",
    "rp_menages_2023": "DS_RP_MENAGES_COMP_2023_CSV_FR.zip",
    "rp_population_2023": "DS_RP_POPULATION_PRINC_2023_CSV_FR.zip",
}
BDNB_DEPARTMENTS = ("22", "29", "35", "56")
BDNB_ENTRIES = (
    "rel_batiment_groupe_dvf_open.csv",
    "batiment_groupe.csv",
    "batiment_groupe_ffo_bat.csv",
    "batiment_groupe_bdtopo_bat.csv",
    "batiment_groupe_synthese_propriete_usage.csv",
    "metadonnees_jeu_de_donnee_source.csv",
)

# --- Model ----------------------------------------------------------------
SEED = 20261029
SAMPLE_FRACTION = 0.20  # deterministic compute sample of the model-estimation subset
SPATIAL_BLOCK_KM = 25.0
SPATIAL_FOLDS = 5
XGB_PARAMS = {
    "objective": "reg:squarederror",
    "max_depth": 6,
    "eta": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 20,
    "lambda": 1.0,
    "tree_method": "hist",
    "seed": SEED,
}
XGB_ROUNDS = 1500
XGB_EARLY_STOPPING = 30
THREADS = 8


@dataclass(frozen=True)
class ReportingGroup:
    name: str
    block: str


# Presentation groups. Every model input belongs to exactly one block; the
# mapping is asserted complete by the tests.
REPORTING_GROUPS = (
    ReportingGroup("property", "Property sold and BDNB group context"),
    ReportingGroup("access", "AEDAR accessibility"),
    ReportingGroup("local", "Local setting"),
    ReportingGroup("commune_context", "Commune housing/demographic context"),
    ReportingGroup("timing", "Sale timing"),
    ReportingGroup("space", "Joint spatial component"),
)


@dataclass
class Paths:
    raw: Path = RAW_DIR
    extract: Path = EXTRACT_DIR
    private: Path = PRIVATE_DIR
    evidence: Path = EVIDENCE_DIR
    extra: dict = field(default_factory=dict)
