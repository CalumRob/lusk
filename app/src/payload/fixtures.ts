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
 * Histoires — the 2x2 story quadrant (solde naturel × solde migratoire):
 * 22001 fertile, 22002 vieillissante, 29001 attractive, 29002 exode.
 * story_key kept from the R schema (CONTEXT.md §Story).
 */
export const histoiresDemographieFixture: Histoire[] = [
  { territoire: '22001', type: 'commune', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 70, solde_migratoire: 30, classification: 'fertile' },
  { territoire: '22002', type: 'commune', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: -20, solde_migratoire: -5, classification: 'vieillissante' },
  { territoire: '29001', type: 'commune', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 20, solde_migratoire: 380, classification: 'attractive' },
  { territoire: '29002', type: 'commune', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: -20, solde_migratoire: -380, classification: 'exode' },
  { territoire: '200000001', type: 'epci', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 50, solde_migratoire: 25, classification: 'fertile' },
  { territoire: '200000002', type: 'epci', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 0, solde_migratoire: 0, classification: 'vieillissante' },
  { territoire: '22', type: 'departement', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 50, solde_migratoire: 25, classification: 'fertile' },
  { territoire: '29', type: 'departement', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 0, solde_migratoire: 0, classification: 'vieillissante' },
  { territoire: '53', type: 'region', theme: 'demographie', story_key: 'attractive-ou-fertile', solde_naturel: 50, solde_migratoire: 25, classification: 'fertile' },
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
