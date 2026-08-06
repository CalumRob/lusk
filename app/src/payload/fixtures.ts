/**
 * Synthetic fixture JSONs for the payload layer — the app's mirror of the R
 * fixture (pipeline/tests/testthat/helper-fixture.R + test-contract-payload.R).
 *
 * Same fixture in both languages (docs/architecture.md §Testing): 4 communes
 * across 2 EPCIs in 2 départements + la région (9 territoires), covering the
 * four Story quadrants, a rank tie, NA ranks, NA apercu KPIs, a missing theme
 * and the run-report variants. The values locked by the R contract test are
 * mirrored exactly (territoire codes, noms, populations, densités, ranks).
 *
 * These are RAW row shapes — exactly what the JSON files in public/data/
 * contain. They feed the validators (app's half of validate_payload()) and
 * the loader's fetch seam; nothing here touches the fetch layer.
 */

import type {
  ApercuRow,
  Histoire,
  Indicateur,
  RunReport,
  Territoire,
  Vintage,
} from './types'

/** 9 territoires — codes, noms and EPCI/département ladder from the R fixture. */
export const territoiresFixture: Territoire[] = [
  { territoire: '22001', type: 'commune', nom: 'Commune A1', departement: '22', epci: '200000001' },
  { territoire: '22002', type: 'commune', nom: 'Commune D', departement: '22', epci: '200000001' },
  { territoire: '29001', type: 'commune', nom: 'Commune B', departement: '29', epci: '200000002' },
  { territoire: '29002', type: 'commune', nom: 'Commune C', departement: '29', epci: '200000002' },
  { territoire: '200000001', type: 'epci', nom: 'EPCI X', departement: '22', epci: null },
  { territoire: '200000002', type: 'epci', nom: 'EPCI Y', departement: '29', epci: null },
  { territoire: '22', type: 'departement', nom: 'Département 22', departement: '22', epci: null },
  { territoire: '29', type: 'departement', nom: 'Département 29', departement: '29', epci: null },
  { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
]

/**
 * Démographie indicateurs. Values mirror the committed payload (the R
 * fixture's output): the densite rows carry the rank tie (29001 = 29002,
 * both 0.25 dans l'EPCI) and the NA-rank ladder (EPCI: rang_epci null;
 * département: rang_dep null; région: all null). structure_age for 22001
 * exercises the multi-value key (detail = tranche d'âge).
 */
const vintageDemographie = {
  vintage_source: 'INSEE — Série historique du recensement',
  vintage_version: '2023',
  vintage_date_reference: '2023-01-01',
  vintage_date_publication: '2026-06-30',
}

/** The ménages source — its own vintage (the reference source of taille_menages). */
const vintageMenages = {
  vintage_source: 'INSEE — Ménages (dossier complet)',
  vintage_version: '2023',
  vintage_date_reference: '2023-01-01',
  vintage_date_publication: '2026-06-30',
}

export const indicateursDemographieFixture: Indicateur[] = [
  // densite — 9 territoires, ranks from the R fixture output
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 200, unit: 'hab/km²', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, ...vintageDemographie },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 50, unit: 'hab/km²', rang_epci: 0, rang_dep: 0, rang_reg: 0, ...vintageDemographie },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: 0.25, rang_dep: 0.25, rang_reg: 0.375, ...vintageDemographie },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: 0.25, rang_dep: 0.25, rang_reg: 0.375, ...vintageDemographie },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'densite', detail: null, value: 133.33333333333334, unit: 'hab/km²', rang_epci: null, rang_dep: 0, rang_reg: 0, ...vintageDemographie },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: null, rang_dep: 0, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'densite', detail: null, value: 133.33333333333334, unit: 'hab/km²', rang_epci: null, rang_dep: null, rang_reg: 0, ...vintageDemographie },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: null, rang_dep: null, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'densite', detail: null, value: 144.82758620689654, unit: 'hab/km²', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageDemographie },
  // structure_age — the multi-value key (one row per tranche), 22001
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '<15', value: 0.3, unit: '%', rang_epci: 0.4, rang_dep: 0.4, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '15-24', value: 0.15, unit: '%', rang_epci: 0.3, rang_dep: 0.3, rang_reg: 0.4, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '25-39', value: 0.2, unit: '%', rang_epci: 0.6, rang_dep: 0.6, rang_reg: 0.7, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '40-54', value: 0.15, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.6, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '55-64', value: 0.05, unit: '%', rang_epci: 0.2, rang_dep: 0.2, rang_reg: 0.3, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '65-79', value: 0.1, unit: '%', rang_epci: 0.4, rang_dep: 0.4, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '80+', value: 0.05, unit: '%', rang_epci: 0.3, rang_dep: 0.3, rang_reg: 0.4, ...vintageDemographie },
  // evolution_1968 — the long-run series (1968 → 2023), a fraction with unit '%'
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.33333333333333331, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, ...vintageDemographie },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: -0.33333333333333331, unit: '%', rang_epci: 0, rang_dep: 0, rang_reg: 0, ...vintageDemographie },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.25, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: -0.090909090909090912, unit: '%', rang_epci: 0, rang_dep: 0, rang_reg: 0.25, ...vintageDemographie },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.14285714285714285, unit: '%', rang_epci: null, rang_dep: 0, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.052631578947368418, unit: '%', rang_epci: null, rang_dep: 0, rang_reg: 0, ...vintageDemographie },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.14285714285714285, unit: '%', rang_epci: null, rang_dep: null, rang_reg: 0.5, ...vintageDemographie },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.052631578947368418, unit: '%', rang_epci: null, rang_dep: null, rang_reg: 0, ...vintageDemographie },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.076923076923076927, unit: '%', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageDemographie },
  // taille_menages — its own reference source (ménages)
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2941176470588234, unit: 'pers./ménage', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, ...vintageMenages },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2285714285714286, unit: 'pers./ménage', rang_epci: 0, rang_dep: 0, rang_reg: 0.5, ...vintageMenages },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0857142857142859, unit: 'pers./ménage', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.25, ...vintageMenages },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 1.9666666666666666, unit: 'pers./ménage', rang_epci: 0, rang_dep: 0, rang_reg: 0, ...vintageMenages },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2829268292682925, unit: 'pers./ménage', rang_epci: null, rang_dep: 0, rang_reg: 0.5, ...vintageMenages },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0241379310344829, unit: 'pers./ménage', rang_epci: null, rang_dep: 0, rang_reg: 0, ...vintageMenages },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2829268292682925, unit: 'pers./ménage', rang_epci: null, rang_dep: null, rang_reg: 0.5, ...vintageMenages },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0241379310344829, unit: 'pers./ménage', rang_epci: null, rang_dep: null, rang_reg: 0, ...vintageMenages },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0917197452229299, unit: 'pers./ménage', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageMenages },
]

/**
 * Histoires — the rate-quadrant story (ADR-0011): the two annualized
 * per-mille rates (taux_solde_*) cross at 0; classification is their signs.
 * Rates mirror the R fixture output (solde / 6 ans / population moyenne
 * × 1000, population moyenne = (pop_prec + pop) / 2).
 */
export const histoiresDemographieFixture: Histoire[] = [
  { territoire: '22001', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 70, solde_migratoire: 30, taux_solde_naturel: 5.982905982905983, taux_solde_migratoire: 2.564102564102564, classification: 'attire-renouvelle' },
  { territoire: '22002', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: -20, solde_migratoire: -5, taux_solde_naturel: -8.080808080808081, taux_solde_migratoire: -2.02020202020202, classification: 'vide-meurt' },
  { territoire: '29001', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 20, solde_migratoire: 380, taux_solde_naturel: 1.19047619047619, taux_solde_migratoire: 22.61904761904762, classification: 'attire-renouvelle' },
  { territoire: '29002', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: -20, solde_migratoire: -380, taux_solde_naturel: -1.041666666666667, taux_solde_migratoire: -19.79166666666667, classification: 'vide-meurt' },
  { territoire: '200000001', type: 'epci', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 3.527336860670194, taux_solde_migratoire: 1.763668430335097, classification: 'attire-renouvelle' },
  { territoire: '200000002', type: 'epci', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 0, solde_migratoire: 0, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: 'vide-meurt' },
  { territoire: '22', type: 'departement', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 3.527336860670194, taux_solde_migratoire: 1.763668430335097, classification: 'attire-renouvelle' },
  { territoire: '29', type: 'departement', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 0, solde_migratoire: 0, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: 'vide-meurt' },
  { territoire: '53', type: 'region', theme: 'demographie', story_key: 'trajectoire-demographique', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 0.9965122072700558, taux_solde_migratoire: 0.4982561036350279, classification: 'attire-renouvelle' },
]

/**
 * Aperçu basic stats (ADR-0007): one row per (territoire × key).
 * Values mirror the R fixture output (population 22001 = 2000, 200000001 =
 * 2400, 53 = 8400; densite 22001 = 200; part_65_plus 22001 = 0.15).
 */
export const apercuFixture: ApercuRow[] = [
  { territoire: '22001', type: 'commune', key: 'population', value: 2000, unit: 'hab.' },
  { territoire: '22002', type: 'commune', key: 'population', value: 400, unit: 'hab.' },
  { territoire: '29001', type: 'commune', key: 'population', value: 3000, unit: 'hab.' },
  { territoire: '29002', type: 'commune', key: 'population', value: 3000, unit: 'hab.' },
  { territoire: '200000001', type: 'epci', key: 'population', value: 2400, unit: 'hab.' },
  { territoire: '200000002', type: 'epci', key: 'population', value: 6000, unit: 'hab.' },
  { territoire: '22', type: 'departement', key: 'population', value: 2400, unit: 'hab.' },
  { territoire: '29', type: 'departement', key: 'population', value: 6000, unit: 'hab.' },
  { territoire: '53', type: 'region', key: 'population', value: 8400, unit: 'hab.' },
  { territoire: '22001', type: 'commune', key: 'densite', value: 200, unit: 'hab/km²' },
  { territoire: '22002', type: 'commune', key: 'densite', value: 50, unit: 'hab/km²' },
  { territoire: '29001', type: 'commune', key: 'densite', value: 150, unit: 'hab/km²' },
  { territoire: '29002', type: 'commune', key: 'densite', value: 150, unit: 'hab/km²' },
  { territoire: '200000001', type: 'epci', key: 'densite', value: 133.33333333333334, unit: 'hab/km²' },
  { territoire: '200000002', type: 'epci', key: 'densite', value: 150, unit: 'hab/km²' },
  { territoire: '22', type: 'departement', key: 'densite', value: 133.33333333333334, unit: 'hab/km²' },
  { territoire: '29', type: 'departement', key: 'densite', value: 150, unit: 'hab/km²' },
  { territoire: '53', type: 'region', key: 'densite', value: 144.82758620689654, unit: 'hab/km²' },
  { territoire: '22001', type: 'commune', key: 'part_65_plus', value: 0.15, unit: '%' },
  { territoire: '22002', type: 'commune', key: 'part_65_plus', value: 0.175, unit: '%' },
  { territoire: '29001', type: 'commune', key: 'part_65_plus', value: 0.18333333333333332, unit: '%' },
  { territoire: '29002', type: 'commune', key: 'part_65_plus', value: 0.23333333333333334, unit: '%' },
  { territoire: '200000001', type: 'epci', key: 'part_65_plus', value: 0.15416666666666667, unit: '%' },
  { territoire: '200000002', type: 'epci', key: 'part_65_plus', value: 0.20833333333333334, unit: '%' },
  { territoire: '22', type: 'departement', key: 'part_65_plus', value: 0.15416666666666667, unit: '%' },
  { territoire: '29', type: 'departement', key: 'part_65_plus', value: 0.20833333333333334, unit: '%' },
  { territoire: '53', type: 'region', key: 'part_65_plus', value: 0.19285714285714287, unit: '%' },
]

/**
 * Aperçu variant with an NA KPI — value null = not computable for that
 * territory (e.g. a part with no reliable base). The Aperçu selector must
 * NA-gate it away.
 */
export const apercuAvecNAFixture: ApercuRow[] = apercuFixture.map((ligne) =>
  ligne.territoire === '22002' && ligne.key === 'part_65_plus'
    ? { ...ligne, value: null }
    : ligne,
)

/** Run report all-frais (the committed shape, CONTEXT.md §Run report). */
export const runReportFraisFixture: RunReport = {
  mode: 'full',
  timestamp: '2026-08-03T22:03:28Z',
  statuts: [
    { id: 'serie_historique', mode: 'cron', status: 'frais' },
    { id: 'menages', mode: 'cron', status: 'frais' },
    { id: 'age_detail', mode: 'cron', status: 'frais' },
    { id: 'epci', mode: 'cron', status: 'frais' },
  ],
}

/** Run report variant with one failed source (the freshness line's échec branch). */
export const runReportEchecFixture: RunReport = {
  mode: 'full',
  timestamp: '2026-08-03T22:03:28Z',
  statuts: [
    { id: 'serie_historique', mode: 'cron', status: 'frais' },
    { id: 'menages', mode: 'cron', status: 'échec' },
    { id: 'age_detail', mode: 'cron', status: 'frais' },
    { id: 'epci', mode: 'cron', status: 'frais' },
  ],
}

/** Run report variant with a manual source (the freshness line's « à traiter » branch). */
export const runReportManuelFixture: RunReport = {
  mode: 'manuel',
  timestamp: '2026-08-03T22:03:28Z',
  statuts: [
    { id: 'serie_historique', mode: 'cron', status: 'frais' },
    { id: 'menages', mode: 'manuel', status: 'à traiter à la main' },
  ],
}

/**
 * The shared vintage table (vintages.json) — one row per dataset of the run.
 * The Démographie story cites ITS two datasets from here: the série
 * historique (rates) and the base des EPCI (the nuage's comparison groups).
 */
export const vintagesFixture: Vintage[] = [
  {
    id: 'serie_historique',
    source: 'INSEE — Série historique du recensement',
    version: '2023',
    licence: 'lov2',
    date_reference: '2023-01-01',
    date_publication: '2026-06-30',
  },
  {
    id: 'menages',
    source: 'INSEE — Ménages (dossier complet)',
    version: '2023',
    licence: 'lov2',
    date_reference: '2023-01-01',
    date_publication: '2026-06-30',
  },
  {
    id: 'age_detail',
    source: 'INSEE — Population par sexe et âge (PRINC)',
    version: '2023',
    licence: 'lov2',
    date_reference: '2023-01-01',
    date_publication: '2026-06-30',
  },
  {
    id: 'epci',
    source: 'INSEE — Base des EPCI à fiscalité propre au 01/01/2025',
    version: '2025',
    licence: 'lov2',
    date_reference: '2025-01-01',
    date_publication: null,
  },
  {
    id: 'mobilite_snapshot',
    source:
      "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
    version: '2026-02',
    licence: 'odbl',
    date_reference: '2026-02-28',
    date_publication: '2026-08-06',
  },
]

/** A second theme (habitat) — for the payload-driven tab bar (ADR-0007). */
export const indicateursHabitatFixture: Indicateur[] = [
  {
    territoire: '22001',
    type: 'commune',
    theme: 'habitat',
    key: 'part_residences_secondaires',
    detail: null,
    value: 0.18,
    unit: '%',
    rang_epci: 0.6,
    rang_dep: 0.6,
    rang_reg: 0.7,
    vintage_source: 'INSEE — Logements (dossier complet)',
    vintage_version: '2023',
    vintage_date_reference: '2023-01-01',
    vintage_date_publication: '2026-06-30',
  },
  {
    territoire: '53',
    type: 'region',
    theme: 'habitat',
    key: 'part_residences_secondaires',
    detail: null,
    value: 0.12,
    unit: '%',
    rang_epci: null,
    rang_dep: null,
    rang_reg: null,
    vintage_source: 'INSEE — Logements (dossier complet)',
    vintage_version: '2023',
    vintage_date_reference: '2023-01-01',
    vintage_date_publication: '2026-06-30',
  },
]

export const histoiresHabitatFixture: Histoire[] = [
  {
    territoire: '22001',
    type: 'commune',
    theme: 'habitat',
    story_key: 'etat-energetique-du-parc',
    classification: 'parc-performant',
    part_passoires: 0.13333333333333333,
    part_abc: 0.5,
    n_dpe: 90,
  },
  {
    territoire: '53',
    type: 'region',
    theme: 'habitat',
    story_key: 'etat-energetique-du-parc',
    classification: 'parc-intermediaire',
    part_passoires: 0.08704730274243572,
    part_abc: 0.4590208416431279,
    n_dpe: 737082,
  },
]

/**
 * Économie fixture — the three indicator keys and the two Story keys, VALUES
 * extracted from the REAL reshaped payload (public/data/indicateurs_economie.json,
 * histoires_economie.json, run 2026-08-06, issue #131): one commune (22001), one
 * EPCI (the real 200027027 rows, remapped to the fixture's 200000001), the
 * département 22 and the région 53. Nothing invented — every label, value and
 * vintage is copied from the committed payload.
 */

/** Flores A88 — the reference source of effectifs_salaires. */
const vintageFlores = {
  vintage_source:
    "INSEE — Flores : nombre d'établissements et effectifs salariés par secteur d'activité (A88)",
  vintage_version: '2024',
  vintage_date_reference: '2024-12-31',
  vintage_date_publication: '2026-03-31',
}

/** RP emploi — the reference source of chomage. */
const vintageRpChomage = {
  vintage_source:
    'INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)',
  vintage_version: '2023',
  vintage_date_reference: '2023-01-01',
  vintage_date_publication: '2026-07-15',
}

/** SIRENE régional — the reference source of eco_activites AND the two Stories. */
const vintageSirene = {
  vintage_source: 'data.bretagne.bzh — Base SIRENE - Région Bretagne (sirene-v3-consolidee)',
  vintage_version: '2026-04',
  vintage_date_reference: '2026-03-31',
  vintage_date_publication: '2026-05-01',
}

/**
 * The three Économie indicators (issue #131): « Taille » (effectifs_salaries,
 * Flores A88), « santé » (chomage, RP) and « verdure » (eco_activites, SIRENE ×
 * EGSS) — FIXED multiplicity: one line per territory, the contract order
 * effectifs_salaries → chomage → eco_activites (INDICATEURS_ECONOMIE, theme_economie.R).
 */
export const indicateursEconomieFixture: Indicateur[] = [
  // la commune 22001 — les valeurs réelles du payload reshapé
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 31, unit: 'salariés', rang_epci: 0.23684210526315788, rang_dep: 0.26308139534883723, rang_reg: 0.16181364392678868, ...vintageFlores },
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'chomage', detail: null, value: 0.07117029606927434, unit: '%', rang_epci: 0.2631578947368421, rang_dep: 0.26744186046511625, rang_reg: 0.3752079866888519, ...vintageRpChomage },
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'eco_activites', detail: null, value: 0.541095890410959, unit: '%', rang_epci: 0.9473684210526315, rang_dep: 0.9447674418604651, rang_reg: 0.9816971713810316, ...vintageSirene },
  // l'EPCI (les lignes réelles de 200027027, remappées sur le 200000001 du fixture)
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 6967, unit: 'salariés', rang_epci: null, rang_dep: 0.42857142857142855, rang_reg: 0.3442622950819672, ...vintageFlores },
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'chomage', detail: null, value: 0.08533735474411866, unit: '%', rang_epci: null, rang_dep: 0.2857142857142857, rang_reg: 0.4098360655737705, ...vintageRpChomage },
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'eco_activites', detail: null, value: 0.26564928642079977, unit: '%', rang_epci: null, rang_dep: 0.42857142857142855, rang_reg: 0.5409836065573771, ...vintageSirene },
  // le département 22
  { territoire: '22', type: 'departement', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 199446, unit: 'salariés', rang_epci: null, rang_dep: null, rang_reg: 0, ...vintageFlores },
  { territoire: '22', type: 'departement', theme: 'economie', key: 'chomage', detail: null, value: 0.09569409103288876, unit: '%', rang_epci: null, rang_dep: null, rang_reg: 0.5, ...vintageRpChomage },
  { territoire: '22', type: 'departement', theme: 'economie', key: 'eco_activites', detail: null, value: 0.24933991838991001, unit: '%', rang_epci: null, rang_dep: null, rang_reg: 0.75, ...vintageSirene },
  // la région 53
  { territoire: '53', type: 'region', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 1261149, unit: 'salariés', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageFlores },
  { territoire: '53', type: 'region', theme: 'economie', key: 'chomage', detail: null, value: 0.09329395376073676, unit: '%', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageRpChomage },
  { territoire: '53', type: 'region', theme: 'economie', key: 'eco_activites', detail: null, value: 0.22450225227303586, unit: '%', rang_epci: null, rang_dep: null, rang_reg: null, ...vintageSirene },
]

/**
 * The two Économie Stories (issue #120) — MULTI-LIGNES, top-5 par
 * (territoire × story_key), triées par rang : « ce que la commune abrite » (la
 * spécialisation LQ, communes/EPCIs/départements) et « ce que la Bretagne
 * abrite » (la lecture de structure de la région, story_key dédié sur 53).
 * Labels et nombres réels du payload reshapé — jamais codés en dur.
 */
export const histoiresEconomieFixture: Histoire[] = [
  // 22001 — top-5 de spécialisation (LQ)
  { territoire: '22001', type: 'commune', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 1, activity_code: '01.47Z', activity_label: 'Élevage de volailles', lq: 23.6794426899885, n: 12, part_parc: null, ...vintageSirene },
  { territoire: '22001', type: 'commune', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 2, activity_code: '46.23Z', activity_label: "Commerce de gros (commerce interentreprises) d'animaux vivants", lq: 22.98966541398957, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22001', type: 'commune', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 3, activity_code: '36.00Z', activity_label: "Captage, traitement et distribution d'eau", lq: 19.31473748535927, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22001', type: 'commune', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 4, activity_code: '77.29Z', activity_label: "Location et location-bail d'autres biens personnels et domestiques", lq: 11.125619665014225, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22001', type: 'commune', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 5, activity_code: '78.30Z', activity_label: 'Autre mise à disposition de ressources humaines', lq: 10.999995166326697, n: 3, part_parc: null, ...vintageSirene },
  // l'EPCI (les lignes réelles de 200027027, remappées)
  { territoire: '200000001', type: 'epci', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 1, activity_code: '08.93Z', activity_label: 'Production de sel', lq: 35.69822429466346, n: 2, part_parc: null, ...vintageSirene },
  { territoire: '200000001', type: 'epci', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 2, activity_code: '15.11Z', activity_label: 'Apprêt et tannage des cuirs ; préparation et teinture des fourrures', lq: 21.418934576798076, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '200000001', type: 'epci', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 3, activity_code: '11.02B', activity_label: 'Vinification', lq: 17.84911214733173, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '200000001', type: 'epci', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 4, activity_code: '50.30Z', activity_label: 'Transports fluviaux de passagers', lq: 17.84911214733173, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '200000001', type: 'epci', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 5, activity_code: '25.92Z', activity_label: "Fabrication d'emballages métalliques légers", lq: 15.299238983427198, n: 1, part_parc: null, ...vintageSirene },
  // le département 22
  { territoire: '22', type: 'departement', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 1, activity_code: '01.22Z', activity_label: 'Culture de fruits tropicaux et subtropicaux', lq: 5.51753307681677, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22', type: 'departement', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 2, activity_code: '07.10Z', activity_label: 'Extraction de minerais de fer', lq: 5.51753307681677, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22', type: 'departement', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 3, activity_code: '08.91Z', activity_label: "Extraction des minéraux chimiques et d'engrais minéraux", lq: 5.51753307681677, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22', type: 'departement', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 4, activity_code: '14.20Z', activity_label: "Fabrication d'articles en fourrure", lq: 5.51753307681677, n: 1, part_parc: null, ...vintageSirene },
  { territoire: '22', type: 'departement', theme: 'economie', story_key: 'ce-que-la-commune-abrite', rang: 5, activity_code: '25.94Z', activity_label: 'Fabrication de vis et de boulons', lq: 5.51753307681677, n: 1, part_parc: null, ...vintageSirene },
  // la région 53 — la lecture de structure (story_key dédié, lq dégénérée)
  { territoire: '53', type: 'region', theme: 'economie', story_key: 'ce-que-la-bretagne-abrite', rang: 1, activity_code: '68.20B', activity_label: "Location de terrains et d'autres biens immobiliers", lq: null, n: 124881, part_parc: 0.16462751477456836, ...vintageSirene },
  { territoire: '53', type: 'region', theme: 'economie', story_key: 'ce-que-la-bretagne-abrite', rang: 2, activity_code: '68.20A', activity_label: 'Location de logements', lq: null, n: 71660, part_parc: 0.09446759482023341, ...vintageSirene },
  { territoire: '53', type: 'region', theme: 'economie', story_key: 'ce-que-la-bretagne-abrite', rang: 3, activity_code: '94.99Z', activity_label: 'Autres organisations fonctionnant par adhésion volontaire', lq: null, n: 30531, part_parc: 0.04024825756986528, ...vintageSirene },
  { territoire: '53', type: 'region', theme: 'economie', story_key: 'ce-que-la-bretagne-abrite', rang: 4, activity_code: '70.10Z', activity_label: 'Activités des sièges sociaux', lq: null, n: 16207, part_parc: 0.02136528480674746, ...vintageSirene },
  { territoire: '53', type: 'region', theme: 'economie', story_key: 'ce-que-la-bretagne-abrite', rang: 5, activity_code: '47.99A', activity_label: 'Vente à domicile', lq: null, n: 13826, part_parc: 0.0182264717552965, ...vintageSirene },
]
