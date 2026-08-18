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

import type { Fichier } from './loader'
import type {
  ApercuRow,
  Histoire,
  Indicateur,
  MembreProgramme,
  Payload,
  ProgrammesPayload,
  RunReport,
  SubventionProgramme,
  Territoire,
  Theme,
  ThemeMetadata,
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
  // densite — 9 territoires, rangs ordinaux du R fixture (ADR-0015/0021 : une
  // commune se classe dans SON EPCI — rang_epci ; un EPCI ou un département
  // parmi ses pairs régionaux — rang_reg ; la région nulle part). L'ex æquo
  // 29001/29002 (150 dans l'EPCI Y) partage la 1re place — competition ranking.
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 200, unit: 'hab/km²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 50, unit: 'hab/km²', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'densite', detail: null, value: 133.33333333333334, unit: 'hab/km²', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'densite', detail: null, value: 133.33333333333334, unit: 'hab/km²', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'densite', detail: null, value: 150, unit: 'hab/km²', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'densite', detail: null, value: 144.82758620689654, unit: 'hab/km²', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  // structure_age — the multi-value key (issue #390) : 14 lignes pour 22001 —
  // 7 tranches d'âge × 2 sexes (F / M). `detail` reste la tranche ; `sex` porte
  // le sexe. Chaque part = effectif du sexe / population (ici 0.6 F / 0.4 M par
  // tranche, les 14 parts sommant à 1). Toutes les lignes partagent le rang du
  // scalaire (le même motif que la machinerie).
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '<15', sex: 'F', value: 0.18, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '15-24', sex: 'F', value: 0.09, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '25-39', sex: 'F', value: 0.12, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '40-54', sex: 'F', value: 0.09, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '55-64', sex: 'F', value: 0.03, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '65-79', sex: 'F', value: 0.06, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '80+', sex: 'F', value: 0.03, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '<15', sex: 'M', value: 0.12, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '15-24', sex: 'M', value: 0.06, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '25-39', sex: 'M', value: 0.08, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '40-54', sex: 'M', value: 0.06, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '55-64', sex: 'M', value: 0.02, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '65-79', sex: 'M', value: 0.04, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '80+', sex: 'M', value: 0.02, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  // evolution_1968 — the long-run series (1968 → 2023), a fraction with unit '%'
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.33333333333333331, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: -0.33333333333333331, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.25, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'evolution_1968', detail: null, value: -0.090909090909090912, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.14285714285714285, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.052631578947368418, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.14285714285714285, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.052631578947368418, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageDemographie },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'evolution_1968', detail: null, value: 0.076923076923076927, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageDemographie },
  // taille_menages — its own reference source (ménages)
  { territoire: '22001', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2941176470588234, unit: 'pers./ménage', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageMenages },
  { territoire: '22002', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2285714285714286, unit: 'pers./ménage', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageMenages },
  { territoire: '29001', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0857142857142859, unit: 'pers./ménage', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageMenages },
  { territoire: '29002', type: 'commune', theme: 'demographie', key: 'taille_menages', detail: null, value: 1.9666666666666666, unit: 'pers./ménage', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageMenages },
  { territoire: '200000001', type: 'epci', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2829268292682925, unit: 'pers./ménage', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageMenages },
  { territoire: '200000002', type: 'epci', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0241379310344829, unit: 'pers./ménage', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageMenages },
  { territoire: '22', type: 'departement', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.2829268292682925, unit: 'pers./ménage', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageMenages },
  { territoire: '29', type: 'departement', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0241379310344829, unit: 'pers./ménage', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageMenages },
  { territoire: '53', type: 'region', theme: 'demographie', key: 'taille_menages', detail: null, value: 2.0917197452229299, unit: 'pers./ménage', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageMenages },
]

/**
 * Histoires — the rate-quadrant story (ADR-0011): the two annualized
 * per-mille rates (taux_solde_*) cross at 0; classification is their signs.
 * Rates mirror the R fixture output (solde / 6 ans / population moyenne
 * × 1000, population moyenne = (pop_prec + pop) / 2).
 */
export const histoiresDemographieFixture: Histoire[] = [
  { territoire: '22001', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 70, solde_migratoire: 30, taux_solde_naturel: 5.982905982905983, taux_solde_migratoire: 2.564102564102564, classification: 'attire-renouvelle' },
  { territoire: '22002', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: -20, solde_migratoire: -5, taux_solde_naturel: -8.080808080808081, taux_solde_migratoire: -2.02020202020202, classification: 'vide-meurt' },
  { territoire: '29001', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 20, solde_migratoire: 380, taux_solde_naturel: 1.19047619047619, taux_solde_migratoire: 22.61904761904762, classification: 'attire-renouvelle' },
  { territoire: '29002', type: 'commune', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: -20, solde_migratoire: -380, taux_solde_naturel: -1.041666666666667, taux_solde_migratoire: -19.79166666666667, classification: 'vide-meurt' },
  { territoire: '200000001', type: 'epci', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 3.527336860670194, taux_solde_migratoire: 1.763668430335097, classification: 'attire-renouvelle' },
  { territoire: '200000002', type: 'epci', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 0, solde_migratoire: 0, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: 'vide-meurt' },
  { territoire: '22', type: 'departement', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 3.527336860670194, taux_solde_migratoire: 1.763668430335097, classification: 'attire-renouvelle' },
  { territoire: '29', type: 'departement', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 0, solde_migratoire: 0, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: 'vide-meurt' },
  { territoire: '53', type: 'region', theme: 'demographie', story_key: 'trajectoire-demographique', groupe: 'etat-et-dynamique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 50, solde_migratoire: 25, taux_solde_naturel: 0.9965122072700558, taux_solde_migratoire: 0.4982561036350279, classification: 'attire-renouvelle' },
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
  {
    id: 'consoenaf',
    source:
      "Cerema — Consommation d'espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers)",
    version: '2025',
    licence: 'lov2',
    date_reference: '2025-01-01',
    date_publication: '2026-07-24',
  },
]

/** A second theme (habitat) — for the payload-driven tab bar (ADR-0007).
 *  Keyed on the REAL habitat payload (public/data/indicateurs_habitat.json):
 *  the seven registered keys, the 22001 commune carrying the full detail set
 *  (mix_logements 3, statut 4 — HLM comprise —, age_du_bati 6, type 2,
 *  prix_m2 pooled + 5 vintages, part_passoires, distribution_dpe A–G — every
 *  detail the metadata labels, so the loader's parity guard passes), the
 *  région 53 its scalars. DPE rows wear the rolling-base reference (null —
 *  ADR-0009), like the committed payload. */
const vintageHabitatLogements = {
  vintage_source: 'INSEE — Logements (dossier complet)',
  vintage_version: '2023',
  vintage_date_reference: '2023-01-01',
  vintage_date_publication: '2026-06-30',
}

/** DVF — la médiane prix au m² (la référence du millésime le plus récent). */
const vintageHabitatDvf = {
  vintage_source: 'Étalab — DVF géolocalisées',
  vintage_version: '2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2026-06-30',
}

/** DPE — la base roulante (ADR-0009) : la référence est null, jamais inventée. */
const vintageHabitatDpe = {
  vintage_source: 'ADEME — Observatoire DPE, logements existants',
  vintage_version: '2024',
  vintage_date_reference: null,
  vintage_date_publication: '2026-06-30',
}

function ligneHabitat(
  territoire: string,
  type: Territoire['type'],
  key: string,
  detail: string | null,
  value: number,
  unit: string,
  vintage: {
    vintage_source: string
    vintage_version: string
    vintage_date_reference: string | null
    vintage_date_publication: string
  },
): Indicateur {
  return {
    territoire,
    type,
    theme: 'habitat',
    key,
    detail,
    value,
    unit,
    rang_epci: null,
    rang_epci_n: null,
    rang_dep: null,
    rang_dep_n: null,
    rang_reg: null,
    rang_reg_n: null,
    ...vintage,
  }
}

const DETAILS_STATUT: { detail: string; valeur: number }[] = [
  { detail: 'proprietaire', valeur: 0.62 },
  { detail: 'hlm', valeur: 0.12 },
  { detail: 'locataire_prive', valeur: 0.2 },
  { detail: 'loge_gratuit', valeur: 0.06 },
]

const DETAILS_AGE_DU_BATI: { detail: string; valeur: number }[] = [
  { detail: 'lt1919', valeur: 0.08 },
  { detail: '1919_1945', valeur: 0.11 },
  { detail: '1946_1970', valeur: 0.14 },
  { detail: '1971_1990', valeur: 0.21 },
  { detail: '1991_2005', valeur: 0.19 },
  { detail: '2006_plus', valeur: 0.27 },
]

const DETAILS_TYPE: { detail: string; valeur: number }[] = [
  { detail: 'maison', valeur: 0.68 },
  { detail: 'appartement', valeur: 0.32 },
]

export const indicateursHabitatFixture: Indicateur[] = [
  ...['principales', 'secondaires', 'vacants'].map((detail, i) =>
    ligneHabitat('22001', 'commune', 'mix_logements', detail, [0.9, 0.07, 0.03][i]!, '%', vintageHabitatLogements),
  ),
  ...DETAILS_STATUT.map(({ detail, valeur }) =>
    ligneHabitat('22001', 'commune', 'statut', detail, valeur, '%', vintageHabitatLogements),
  ),
  ...DETAILS_AGE_DU_BATI.map(({ detail, valeur }) =>
    ligneHabitat('22001', 'commune', 'age_du_bati', detail, valeur, '%', vintageHabitatLogements),
  ),
  ...DETAILS_TYPE.map(({ detail, valeur }) =>
    ligneHabitat('22001', 'commune', 'type', detail, valeur, '%', vintageHabitatLogements),
  ),
  ligneHabitat('22001', 'commune', 'prix_m2', null, 2450, '€/m²', vintageHabitatDvf),
  ...['2021', '2022', '2023', '2024', '2025'].map((annee, i) =>
    ligneHabitat('22001', 'commune', 'prix_m2', annee, 2100 + i * 90, '€/m²', vintageHabitatDvf),
  ),
  ligneHabitat('22001', 'commune', 'part_passoires', null, 0.13, '%', vintageHabitatDpe),
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((etiquette, i) =>
    ligneHabitat('22001', 'commune', 'distribution_dpe', etiquette, [0.05, 0.1, 0.15, 0.2, 0.2, 0.15, 0.15][i]!, '%', vintageHabitatDpe),
  ),
  ligneHabitat('53', 'region', 'part_passoires', null, 0.12, '%', vintageHabitatDpe),
  ligneHabitat('53', 'region', 'prix_m2', null, 2400, '€/m²', vintageHabitatDvf),
]

export const histoiresHabitatFixture: Histoire[] = [
  {
    territoire: '22001',
    type: 'commune',
    theme: 'habitat',
    story_key: 'etat-energetique-du-parc',
    groupe: 'etat-du-parc',
    salience_reason: 'defaut',
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
    groupe: 'etat-du-parc',
    salience_reason: 'defaut',
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
  vintage_source: 'data.bretagne.bzh — Base SIRENE — Région Bretagne',
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
  // la commune 22001 — les valeurs réelles du payload régénéré (rangs ordinaux)
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 31, unit: 'salariés', rang_epci: 29, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageFlores },
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'chomage', detail: null, value: 0.07117029606927434, unit: '%', rang_epci: 28, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageRpChomage },
  { territoire: '22001', type: 'commune', theme: 'economie', key: 'eco_activites', detail: null, value: 0.541095890410959, unit: '%', rang_epci: 2, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSirene },
  // l'EPCI (les lignes réelles de 200027027, remappées sur le 200000001 du fixture) —
  // un EPCI se classe parmi TOUS les EPCIs bretons (rang_reg, ADR-0021)
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 6967, unit: 'salariés', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 40, rang_reg_n: 61, ...vintageFlores },
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'chomage', detail: null, value: 0.08533735474411866, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 36, rang_reg_n: 61, ...vintageRpChomage },
  { territoire: '200000001', type: 'epci', theme: 'economie', key: 'eco_activites', detail: null, value: 0.26564928642079977, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 28, rang_reg_n: 61, ...vintageSirene },
  // le département 22 — parmi les départements (rang_reg)
  { territoire: '22', type: 'departement', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 199446, unit: 'salariés', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageFlores },
  { territoire: '22', type: 'departement', theme: 'economie', key: 'chomage', detail: null, value: 0.09569409103288876, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 4, ...vintageRpChomage },
  { territoire: '22', type: 'departement', theme: 'economie', key: 'eco_activites', detail: null, value: 0.24933991838991001, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 4, ...vintageSirene },
  // la région 53 — aucun rang (nulle part, ADR-0015)
  { territoire: '53', type: 'region', theme: 'economie', key: 'effectifs_salaries', detail: null, value: 1261149, unit: 'salariés', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageFlores },
  { territoire: '53', type: 'region', theme: 'economie', key: 'chomage', detail: null, value: 0.09329395376073676, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageRpChomage },
  { territoire: '53', type: 'region', theme: 'economie', key: 'eco_activites', detail: null, value: 0.22450225227303586, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSirene },
]

/**
 * The two Économie Stories (issue #120, RÉSOLUES par #312) — UNE lecture par
 * (territoire, groupe) : « ce que la commune abrite » (la spécialisation LQ,
 * communes/EPCIs/départements — groupe sante-et-taille). La structure verte est
 * un sous-groupe indicateur silencieux, sans lecture. Le top-5 est replié dans la ligne (top1_*..top5_* — le
 * rang est l'index). Labels et nombres réels du payload reshapé — jamais codés
 * en dur.
 */
export const histoiresEconomieFixture: Histoire[] = [
  // 22001 — le top-5 de spécialisation (LQ) replié
  {
    territoire: '22001', type: 'commune', theme: 'economie', groupe: 'sante-et-taille', story_key: 'ce-que-la-commune-abrite', salience_reason: 'defaut',
    top1_activity_code: '01.47Z', top1_activity_label: 'Élevage de volailles', top1_lq: 23.6794426899885, top1_n: 12, top1_part_parc: null,
    top2_activity_code: '46.23Z', top2_activity_label: "Commerce de gros (commerce interentreprises) d'animaux vivants", top2_lq: 22.98966541398957, top2_n: 1, top2_part_parc: null,
    top3_activity_code: '36.00Z', top3_activity_label: "Captage, traitement et distribution d'eau", top3_lq: 19.31473748535927, top3_n: 1, top3_part_parc: null,
    top4_activity_code: '77.29Z', top4_activity_label: "Location et location-bail d'autres biens personnels et domestiques", top4_lq: 11.125619665014225, top4_n: 1, top4_part_parc: null,
    top5_activity_code: '78.30Z', top5_activity_label: 'Autre mise à disposition de ressources humaines', top5_lq: 10.999995166326697, top5_n: 3, top5_part_parc: null,
    ...vintageSirene,
  },
  // l'EPCI (les lignes réelles de 200027027, remappées)
  {
    territoire: '200000001', type: 'epci', theme: 'economie', groupe: 'sante-et-taille', story_key: 'ce-que-la-commune-abrite', salience_reason: 'defaut',
    top1_activity_code: '08.93Z', top1_activity_label: 'Production de sel', top1_lq: 35.69822429466346, top1_n: 2, top1_part_parc: null,
    top2_activity_code: '15.11Z', top2_activity_label: 'Apprêt et tannage des cuirs ; préparation et teinture des fourrures', top2_lq: 21.418934576798076, top2_n: 1, top2_part_parc: null,
    top3_activity_code: '11.02B', top3_activity_label: 'Vinification', top3_lq: 17.84911214733173, top3_n: 1, top3_part_parc: null,
    top4_activity_code: '50.30Z', top4_activity_label: 'Transports fluviaux de passagers', top4_lq: 17.84911214733173, top4_n: 1, top4_part_parc: null,
    top5_activity_code: '25.92Z', top5_activity_label: "Fabrication d'emballages métalliques légers", top5_lq: 15.299238983427198, top5_n: 1, top5_part_parc: null,
    ...vintageSirene,
  },
  // le département 22
  {
    territoire: '22', type: 'departement', theme: 'economie', groupe: 'sante-et-taille', story_key: 'ce-que-la-commune-abrite', salience_reason: 'defaut',
    top1_activity_code: '01.22Z', top1_activity_label: 'Culture de fruits tropicaux et subtropicaux', top1_lq: 5.51753307681677, top1_n: 1, top1_part_parc: null,
    top2_activity_code: '07.10Z', top2_activity_label: 'Extraction de minerais de fer', top2_lq: 5.51753307681677, top2_n: 1, top2_part_parc: null,
    top3_activity_code: '08.91Z', top3_activity_label: "Extraction des minéraux chimiques et d'engrais minéraux", top3_lq: 5.51753307681677, top3_n: 1, top3_part_parc: null,
    top4_activity_code: '14.20Z', top4_activity_label: "Fabrication d'articles en fourrure", top4_lq: 5.51753307681677, top4_n: 1, top4_part_parc: null,
    top5_activity_code: '25.94Z', top5_activity_label: 'Fabrication de vis et de boulons', top5_lq: 5.51753307681677, top5_n: 1, top5_part_parc: null,
    ...vintageSirene,
  },
]

/**
 * Mobilité fixture (issue #142) — VALUES extracted from the REAL committed payload
 * (public/data/indicateurs_mobilite.json, histoires_mobilite.json, run 2026-08-06,
 * issues #139/#140/#141) : la commune 22001, l'EPCI 200027027 (remappé sur le
 * 200000001 du fixture), le département 22 et la région 53 — plus la commune 22002
 * (les lignes réelles de la commune saillante 22055, remappées) pour exercer la
 * saillance vélo. Rien d'inventé — chaque valeur et estampille est copiée du payload.
 */

/** Le snapshot porté — la source de référence du flagship (la « Taille », la grille, les Stories). */
const vintageSnapshotMobilite = {
  vintage_source:
    "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
  vintage_version: '2026-02',
  vintage_date_reference: '2026-02-28',
  vintage_date_publication: '2026-08-06',
}

/** L'étage demande — le cube RP exploitation principale (LOG T12). */
const vintageVoituresMobilite = {
  vintage_source:
    "INSEE — Recensement de la population, exploitations principales (Logements) — tableau LOG T12 « Équipement automobile des ménages » (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)",
  vintage_version: '2023',
  vintage_date_reference: '2023-01-01',
  vintage_date_publication: '2026-07-29',
}

/** L'étage réseaux — l'extrait OSM Geofabrik (ODbL, ADR-0001). */
const vintageReseauxMobilite = {
  vintage_source:
    "OpenStreetMap — réseaux routier/cyclable/piéton (extrait Geofabrik Bretagne) — © OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)",
  vintage_version: '2026-08',
  vintage_date_reference: '2026-08-05',
  vintage_date_publication: '2026-08-06',
}

/** Le sous-bloc — la base GTFS Korrigo (ODbL). */
const vintageOffreTcMobilite = {
  vintage_source:
    "Bretagne Mobilité — Korrigo : base multimodale GTFS des transports publics en Bretagne (les 24+ réseaux : BreizhGo TER/car/maritime + les réseaux urbains STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, Kicéo…)",
  vintage_version: '2026-02',
  vintage_date_reference: '2026-02-03',
  vintage_date_publication: '2026-02-03',
}

/** Le sous-bloc — le fichier consolidé IRVE (Licence Ouverte). */
const vintageBornesMobilite = {
  vintage_source:
    "Etalab / data.bretagne.bzh — Fichier consolidé des Bornes de Recharge pour Véhicules Électriques (IRVE), schéma 2.2.0",
  vintage_version: '2026-07',
  vintage_date_reference: '2026-07-28',
  vintage_date_publication: '2026-08-04',
}

/** Le sous-bloc — le hub Ecolab (ODbL, producteur OSM) pris tel quel. */
const vintageStationnementVeloMobilite = {
  vintage_source:
    "Ecolab — Nombre de places de stationnement vélo pour 1 000 hab. (hub d'indicateurs territoriaux de transition écologique ; source OSM : Base Nationale du Stationnement Cyclable)",
  vintage_version: '2022-2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2026-02-03',
}

/**
 * La figure « L'offre cyclable » (issue #232, PRD #226) — la clé multi-mesures
 * du sous-bloc : les longueurs protégé/partagé/total (km, GÉOMÉTRIE UNIQUE —
 * la convention du ratio, ADR-0016) et les km / 1 000 hab précomputés. Les
 * valeurs : la région porte les chiffres verrouillés par l'e2e de #231
 * (protégé 3 290,5 + partagé 1 622,7 = total 4 913,2 km ; 0,961333 /
 * 0,474091 km / 1 000 hab), l'EPCI et le département des valeurs réalistes
 * (total = protégé + partagé, la somme exacte du pipeline), et la commune
 * 22001 porte le ZÉRO — le fait de la commune sans aménagement, jamais une
 * ligne manquante, jamais supprimée. L'estampille est celle de la source de
 * référence osm_reseaux (l'horloge lente du ratio, #226 US6). Le ratio
 * « X % de l'infrastructure routière » n'est PAS dans le payload : l'app le
 * dérive des lignes existantes (total_longueur ÷ reseaux.c_longueur — la
 * règle du « dans l'EPCI : X % » d'ADR-0015, jamais une seconde mesure).
 */
export const indicateursOffreCyclableFixture: Indicateur[] = [
  // ---- 22001 — la commune SANS aménagement : le zéro porté (un fait)
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_longueur', value: 0, unit: 'km', rang_epci: 21, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_km_1000', value: 0, unit: 'km / 1 000 hab', rang_epci: 20, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_longueur', value: 0, unit: 'km', rang_epci: 10, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_km_1000', value: 0, unit: 'km / 1 000 hab', rang_epci: 10, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_cyclable', detail: 'total_longueur', value: 0, unit: 'km', rang_epci: 23, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  // ---- l'EPCI X — des valeurs réalistes (total = protégé + partagé)
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_longueur', value: 21.4, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 26, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_km_1000', value: 0.764, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 18, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_longueur', value: 12.8, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 30, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_km_1000', value: 0.457, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 28, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_cyclable', detail: 'total_longueur', value: 34.2, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 28, rang_reg_n: 61, ...vintageReseauxMobilite },
  // ---- le département 22
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_longueur', value: 412.3, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_km_1000', value: 0.681, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_longueur', value: 187.9, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_km_1000', value: 0.311, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_cyclable', detail: 'total_longueur', value: 600.2, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  // ---- la région 53 — les valeurs verrouillées de l'e2e #231
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_longueur', value: 3290.494, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_cyclable', detail: 'protege_km_1000', value: 0.961333, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_longueur', value: 1622.739, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_cyclable', detail: 'partage_km_1000', value: 0.474091, unit: 'km / 1 000 hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_cyclable', detail: 'total_longueur', value: 4913.233, unit: 'km', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
]

/** Les ONZE clés du thème (INDICATEURS_MOBILITE) : les 5 parts d'isolation de
 * la grille, l'étage demande/réseaux et le sous-bloc — `nb_buildings` QUITTE
 * le payload (issue #368, décision #196) — valeurs réelles du payload
 * reshapé, une ligne par (territoire × key × detail), plus la clé
 * multi-mesures « L'offre cyclable » (issue #232, les lignes
 * d'indicateursOffreCyclableFixture). */
export const indicateursMobiliteFixture: Indicateur[] = [
  // 22001 — la commune réelle : ses rangs ordinaux dans SON EPCI (ADR-0021),
  // tailles portées (le « / Y »), plus aucun rang départemental ou régional.
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'offre_tc', detail: null, value: 0, unit: "%", rang_epci: 16, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOffreTcMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'bornes_recharge', detail: null, value: 0, unit: "bornes", rang_epci: 18, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageBornesMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'places_stationnement_velo_1000', detail: null, value: 0, unit: "places / 1 000 hab", rang_epci: 7, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageStationnementVeloMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'iso_alimentation', detail: null, value: 1, unit: "%", rang_epci: 27, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'iso_sante', detail: null, value: 1, unit: "%", rang_epci: 19, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'iso_administration', detail: null, value: 0.640000000000000, unit: "%", rang_epci: 34, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'iso_ecole', detail: null, value: 1, unit: "%", rang_epci: 31, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'iso_banque', detail: null, value: 1, unit: "%", rang_epci: 16, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'voitures_menage', detail: 'deux_plus', value: 0.482473250797723, unit: "%", rang_epci: 15, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'voitures_menage', detail: 'sans_voiture', value: 0.0552161313870770, unit: "%", rang_epci: 27, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'voitures_menage', detail: 'une_voiture', value: 0.4623106178152, unit: "%", rang_epci: 21, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 'b_densite', value: 0, unit: "km/km²", rang_epci: 23, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 'b_longueur', value: 0, unit: "km", rang_epci: 23, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 'c_densite', value: 3.31530620984322, unit: "km/km²", rang_epci: 16, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 'c_longueur', value: 80.7826445294167, unit: "km", rang_epci: 16, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 't_densite', value: 0.0304553183561826, unit: "km/km²", rang_epci: 25, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '22001', type: 'commune', theme: 'mobilite', key: 'reseaux', detail: 't_longueur', value: 0.742091680549188, unit: "km", rang_epci: 22, rang_epci_n: 38, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  // l'EPCI (les lignes réelles de 200027027, remappées) — un EPCI se classe
  // parmi TOUS les EPCIs bretons (rang_reg — ADR-0021)
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'offre_tc', detail: null, value: 0.327643092813083, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 41, rang_reg_n: 61, ...vintageOffreTcMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'bornes_recharge', detail: null, value: 17, unit: "bornes", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 32, rang_reg_n: 61, ...vintageBornesMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'places_stationnement_velo_1000', detail: null, value: 3.91577645725277, unit: "places / 1 000 hab", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 38, rang_reg_n: 61, ...vintageStationnementVeloMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'iso_alimentation', detail: null, value: 0.389888081395349, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 30, rang_reg_n: 61, ...vintageSnapshotMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'iso_sante', detail: null, value: 0.551351744186046, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 41, rang_reg_n: 61, ...vintageSnapshotMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'iso_administration', detail: null, value: 0.431468750000000, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 41, rang_reg_n: 61, ...vintageSnapshotMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'iso_ecole', detail: null, value: 0.425707848837209, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 37, rang_reg_n: 61, ...vintageSnapshotMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'iso_banque', detail: null, value: 0.700989825581395, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 47, rang_reg_n: 61, ...vintageSnapshotMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'voitures_menage', detail: 'deux_plus', value: 0.471139230368514, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 27, rang_reg_n: 61, ...vintageVoituresMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'voitures_menage', detail: 'sans_voiture', value: 0.0599463471318512, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 48, rang_reg_n: 61, ...vintageVoituresMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'voitures_menage', detail: 'une_voiture', value: 0.468914422499635, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 28, rang_reg_n: 61, ...vintageVoituresMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 'b_densite', value: 0.0531785929720190, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 23, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 'b_longueur', value: 18.8991188731007, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 28, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 'c_densite', value: 3.20869838604353, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 45, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 'c_longueur', value: 1140.33803522539, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 38, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 't_densite', value: 0.284622283773651, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 19, rang_reg_n: 61, ...vintageReseauxMobilite },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', key: 'reseaux', detail: 't_longueur', value: 101.151799518313, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 15, rang_reg_n: 61, ...vintageReseauxMobilite },
  // le département 22 — parmi les départements (rang_reg, ADR-0021)
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'offre_tc', detail: null, value: 0.446562999011482, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageOffreTcMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'bornes_recharge', detail: null, value: 407, unit: "bornes", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageBornesMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'places_stationnement_velo_1000', detail: null, value: 8.82384784726984, unit: "places / 1 000 hab", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageStationnementVeloMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'iso_alimentation', detail: null, value: 0.386755315271068, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageSnapshotMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'iso_sante', detail: null, value: 0.465535709489404, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageSnapshotMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'iso_administration', detail: null, value: 0.380424607757744, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 3, rang_reg_n: 4, ...vintageSnapshotMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'iso_ecole', detail: null, value: 0.378026567721983, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageSnapshotMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'iso_banque', detail: null, value: 0.554599392978969, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageSnapshotMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'voitures_menage', detail: 'deux_plus', value: 0.422902086572718, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 4, ...vintageVoituresMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'voitures_menage', detail: 'sans_voiture', value: 0.0946997418501721, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageVoituresMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'voitures_menage', detail: 'une_voiture', value: 0.48239817157711, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 3, rang_reg_n: 4, ...vintageVoituresMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 'b_densite', value: 0.00992657439927286, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 'b_longueur', value: 69.2726674073839, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 'c_densite', value: 3.61624518147289, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 3, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 'c_longueur', value: 25235.9917574462, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 3, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 't_densite', value: 0.140963882727450, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  { territoire: '22', type: 'departement', theme: 'mobilite', key: 'reseaux', detail: 't_longueur', value: 983.717420719418, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 4, rang_reg_n: 4, ...vintageReseauxMobilite },
  // la région 53 — aucun rang
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'offre_tc', detail: null, value: 0.572896439016138, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOffreTcMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'bornes_recharge', detail: null, value: 1918, unit: "bornes", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageBornesMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'places_stationnement_velo_1000', detail: null, value: 18.4989387483219, unit: "places / 1 000 hab", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageStationnementVeloMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'iso_alimentation', detail: null, value: 0.310494868328787, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'iso_sante', detail: null, value: 0.388552188744812, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'iso_administration', detail: null, value: 0.343320483042356, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'iso_ecole', detail: null, value: 0.323002146164773, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'iso_banque', detail: null, value: 0.502247735738956, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageSnapshotMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'voitures_menage', detail: 'deux_plus', value: 0.402229632062882, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'voitures_menage', detail: 'sans_voiture', value: 0.118268000112935, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'voitures_menage', detail: 'une_voiture', value: 0.479502367824183, unit: "%", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageVoituresMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 'b_densite', value: 0.0346391466921539, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 'b_longueur', value: 950.720513830103, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 'c_densite', value: 3.69278551285507, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 'c_longueur', value: 101353.736321719, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 't_densite', value: 0.245309603230585, unit: "km/km²", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  { territoire: '53', type: 'region', theme: 'mobilite', key: 'reseaux', detail: 't_longueur', value: 6732.87001274969, unit: "km", rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageReseauxMobilite },
  // la douzième clé du thème (issue #232) : la figure « L'offre cyclable » du
  // sous-bloc — 5 mesures par territoire (indicateursOffreCyclableFixture)
  ...indicateursOffreCyclableFixture,
]

/** Les Stories Mobilité (issue #142, RÉSOLUES par #312) — UNE lecture par
 * territoire : le défaut « vingt-minutes-sans-voiture » (div_loss_t + la
 * signature de distribution) pour 22001 / 200000001 / 22 / 53, et — pour la
 * commune saillante 22055 (remappée sur 22002, le delta réel) — la lecture
 * RÉSOLUE « ce-que-le-velo-preserve » : la saillance a REMPLACÉ le défaut, le
 * payload ne porte jamais le pool (ADR-0002). */
export const histoiresMobiliteFixture: Histoire[] = [
  { territoire: '22001', type: 'commune', theme: 'mobilite', story_key: 'vingt-minutes-sans-voiture', groupe: 'acces-aux-services', salience_reason: 'defaut', div_loss_t: 38, div_loss_b: 38, delta: 0, pct_iso_full_t: 0.480000000000000, dens_min: 28, dens_max: 47, dens_1: 0.00591500000000000, dens_2: 0.0148690000000000, dens_3: 0.0315630000000000, dens_4: 0.0577150000000000, dens_5: 0.0988470000000000, dens_6: 0.0916830000000000, dens_7: 0.0441880000000000, dens_8: 0.0320730000000000, dens_9: 0.0456240000000000, dens_10: 0.0412520000000000, dec_1: 33.7000000000000, dec_2: 35, dec_3: 37, dec_4: 37, dec_5: 38, dec_6: 39, dec_7: 40, dec_8: 44, dec_9: 46, dec_10: 47, classification_saillance: 'non-saillant', vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)", vintage_version: "2026-02", vintage_date_reference: "2026-02-28", vintage_date_publication: "2026-08-06" },
  { territoire: '200000001', type: 'epci', theme: 'mobilite', story_key: 'vingt-minutes-sans-voiture', groupe: 'acces-aux-services', salience_reason: 'defaut', div_loss_t: 35, div_loss_b: 33, delta: 2, pct_iso_full_t: 0.140000000000000, dens_min: 4, dens_max: 52, dens_1: 0.00159400000000000, dens_2: 0.0135920000000000, dens_3: 0.0227140000000000, dens_4: 0.0121260000000000, dens_5: 0.0130840000000000, dens_6: 0.0150800000000000, dens_7: 0.0482170000000000, dens_8: 0.0293260000000000, dens_9: 0.0299690000000000, dens_10: 0.00200800000000000, dec_1: 13, dec_2: 17, dec_3: 27, dec_4: 33, dec_5: 35, dec_6: 37, dec_7: 39, dec_8: 43, dec_9: 47, dec_10: 52, classification_saillance: 'non-saillant', vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)", vintage_version: "2026-02", vintage_date_reference: "2026-02-28", vintage_date_publication: "2026-08-06" },
  { territoire: '22', type: 'departement', theme: 'mobilite', story_key: 'vingt-minutes-sans-voiture', groupe: 'acces-aux-services', salience_reason: 'defaut', div_loss_t: 33, div_loss_b: 28, delta: 5, pct_iso_full_t: 0.110000000000000, dens_min: 0, dens_max: 53, dens_1: 0.000664000000000000, dens_2: 0.00899900000000000, dens_3: 0.0158810000000000, dens_4: 0.0145150000000000, dens_5: 0.0204750000000000, dens_6: 0.0219920000000000, dens_7: 0.0232280000000000, dens_8: 0.0283190000000000, dens_9: 0.0251220000000000, dens_10: 0.00512300000000000, dec_1: 11, dec_2: 17, dec_3: 23, dec_4: 28, dec_5: 33, dec_6: 37, dec_7: 41, dec_8: 44, dec_9: 48, dec_10: 53, classification_saillance: 'notable', vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)", vintage_version: "2026-02", vintage_date_reference: "2026-02-28", vintage_date_publication: "2026-08-06" },
  { territoire: '53', type: 'region', theme: 'mobilite', story_key: 'vingt-minutes-sans-voiture', groupe: 'acces-aux-services', salience_reason: 'defaut', div_loss_t: 29, div_loss_b: 22, delta: 7, pct_iso_full_t: 0.100000000000000, dens_min: 0, dens_max: 53, dens_1: 0.00314500000000000, dens_2: 0.0165130000000000, dens_3: 0.0167950000000000, dens_4: 0.0184880000000000, dens_5: 0.0190630000000000, dens_6: 0.0197990000000000, dens_7: 0.0230430000000000, dens_8: 0.0254610000000000, dens_9: 0.0214220000000000, dens_10: 0.00464500000000000, dec_1: 7, dec_2: 13, dec_3: 19, dec_4: 24, dec_5: 29, dec_6: 34, dec_7: 38, dec_8: 42, dec_9: 47, dec_10: 53, classification_saillance: 'notable', vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)", vintage_version: "2026-02", vintage_date_reference: "2026-02-28", vintage_date_publication: "2026-08-06" },
  { territoire: '22002', type: 'commune', theme: 'mobilite', story_key: 'ce-que-le-velo-preserve', groupe: 'acces-aux-services', salience_reason: 'delta-velo-saillant', div_loss_t: 24, div_loss_b: 13, delta: 11, pct_iso_full_t: null, dens_min: null, dens_max: null, dens_1: null, dens_2: null, dens_3: null, dens_4: null, dens_5: null, dens_6: null, dens_7: null, dens_8: null, dens_9: null, dens_10: null, dec_1: null, dec_2: null, dec_3: null, dec_4: null, dec_5: null, dec_6: null, dec_7: null, dec_8: null, dec_9: null, dec_10: null, classification_saillance: 'saillant', distribution_signature: { dens: [0.005915, 0.014869, 0.031563, 0.057715, 0.098847, 0.091683, 0.044188, 0.032073, 0.045624, 0.041252], dec: [33.7, 35, 37, 37, 38, 39, 40, 44, 46, 47], min: 28, max: 47 }, ...vintageSnapshotMobilite },
]

/** Le vintage CONSOENAF — le tampon de SA source de référence (manifest #171). */
const vintageConsoenaf = {
  vintage_source:
    "Cerema — Consommation d'espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers)",
  vintage_version: '2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2026-07-24',
}

/**
 * Le vintage OCS-GE d'artificialisation — le tampon de SA source (manifest
 * #234, amendé #243) : les HUIT archives millésimées « surfaces artificialisées »
 * du produit OCS GE Artificialisation v2.0 (IGN, Nouvelle Génération) de la
 * Géoplateforme (le DIFF est sorti — la couche différentielle n'est pas un
 * état). Le fixture exerce les couches de SES deux départements (22 : 2021/2025 ;
 * 29 : 2021/2024 — les paires de la spec), la région portant la citation
 * combinée de ses deux départements (le span multi-dépt, la discipline du
 * mélange).
 */
const vintageOcsge22 = {
  vintage_source:
    "IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération) — Côtes-d'Armor (22), millésime 2025",
  vintage_version: '2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2026-07-03',
}

const vintageOcsge29 = {
  vintage_source:
    'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération) — Finistère (29), millésime 2024',
  vintage_version: '2024',
  vintage_date_reference: '2024-01-01',
  vintage_date_publication: '2026-06-12',
}

const vintageOcsgeRegion = {
  vintage_source:
    "IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération) — 22 (2021 · 2025) · 29 (2021 · 2024)",
  vintage_version: '2025 · 2024',
  vintage_date_reference: '2024-01-01',
  vintage_date_publication: '2026-07-03',
}

/**
 * Indicateurs Milieux (issue #172 + #173, re-keyés par la spec #225) — VALUES
 * mirror the histoires fixture (artif_m2_par_habitant / artif_m3_par_habitant
 * — l'état par habitant, m²/inhab, deux lignes par territoire : le millésime
 * M2 puis M3, detail = l'année de l'état pour les fenêtres simples, le nom de
 * l'état « M2 »/« M3 » pour la région dont la fenêtre est multi-dépt — le
 * span n'a pas de paire unique) et la série annuelle 2011-2024
 * conso_enaf_annuel (14 lignes pour 22001, detail = l'année — la forme
 * multi-lignes du contrat). La fenêtre et la trajectoire ZAN (conso_enaf_fenetre,
 * trajectoire_zan) sont MORTS avec les flux CONSOENAF : leurs lignes quittent
 * le bloc (la story porte la trajectoire). Les deux lignes de l'état partagent
 * le rang du territoire (l'état à M3, le même rang que la série annuelle).
 */
export const indicateursMilieuxFixture: Indicateur[] = [
  // ---- 22001 — l'état complet + la série annuelle complète. Rangs ordinaux
  // directionnels (ADR-0015) : artif_par_habitant et conso_enaf_annuel sont
  // low-is-good — dans l'EPCI X, 22002 (900 m²/hab) est 1er devant 22001 (2250).
{ territoire: '22001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 2250, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
{ territoire: '22001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2025', value: 2550, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
// les autres millésimes du jeu (35 : 2020/2023 · 56 : 2022/2024) — chaque
// détail déclaré par la métadonnée est publié quelque part (la parité #318)
{ territoire: '22001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2020', value: 2180, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
{ territoire: '22001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2022', value: 2320, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
{ territoire: '22001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2023', value: 2410, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2011', value: 12, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2012', value: 8, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2013', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2014', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2015', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2016', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2017', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2018', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2019', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2020', value: 10, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2021', value: 6, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2022', value: 5, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2023', value: 8, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  { territoire: '22001', type: 'commune', theme: 'milieux', key: 'conso_enaf_annuel', detail: '2024', value: 4.3202, unit: 'ha', rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageConsoenaf },
  // ---- les autres communes : l'état seul (la série annuelle est exercée sur
  // 22001 — la forme multi-lignes du contrat)
  { territoire: '22002', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 900, unit: 'm²/hab', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
  { territoire: '22002', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2025', value: 855, unit: 'm²/hab', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge22 },
  { territoire: '29001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 500, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge29 },
  { territoire: '29001', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2024', value: 530, unit: 'm²/hab', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge29 },
  { territoire: '29002', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 400, unit: 'm²/hab', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge29 },
  { territoire: '29002', type: 'commune', theme: 'milieux', key: 'artif_par_habitant', detail: '2024', value: 403, unit: 'm²/hab', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsge29 },
  // ---- les agrégats (les sommes des communes — la forme du contrat) : les
  // EPCIs se comparent entre eux (rang_reg), jamais dans un département
  { territoire: '200000001', type: 'epci', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 1500, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageOcsge22 },
  { territoire: '200000001', type: 'epci', theme: 'milieux', key: 'artif_par_habitant', detail: '2025', value: 1750, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageOcsge22 },
  { territoire: '200000002', type: 'epci', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 420, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageOcsge29 },
  { territoire: '200000002', type: 'epci', theme: 'milieux', key: 'artif_par_habitant', detail: '2024', value: 410, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageOcsge29 },
  { territoire: '22', type: 'departement', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 1500, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageOcsge22 },
  { territoire: '22', type: 'departement', theme: 'milieux', key: 'artif_par_habitant', detail: '2025', value: 1750, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 2, ...vintageOcsge22 },
  { territoire: '29', type: 'departement', theme: 'milieux', key: 'artif_par_habitant', detail: '2021', value: 420, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageOcsge29 },
  { territoire: '29', type: 'departement', theme: 'milieux', key: 'artif_par_habitant', detail: '2024', value: 425, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 1, rang_reg_n: 2, ...vintageOcsge29 },
  // la région (53) : la fenêtre multi-dépt n'a pas de paire d'années unique —
  // les lignes portent les noms des états (M2/M3), jamais une année inventée
  { territoire: '53', type: 'region', theme: 'milieux', key: 'artif_par_habitant', detail: 'M2', value: 750, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsgeRegion },
  { territoire: '53', type: 'region', theme: 'milieux', key: 'artif_par_habitant', detail: 'M3', value: 830, unit: 'm²/hab', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, ...vintageOcsgeRegion },
]

/**
 * Les Stories Milieux (issue #174, ADR-0014, re-keyées par la spec #225) —
 * « Se densifier, s'étaler, ou s'en aller » : une ligne par territoire, la
 * lecture par les signes (seuil 0), les deux forces (Δpopulation de la série
 * historique, trajectoire de la surface artificialisée par habitant — les
 * états OCS-GE) et les deux fenêtres nommées séparément (periode_pop, le
 * bracket RP partagé « 2017-2023 » ; periode_artif, la fenêtre des états par
 * département — le span multi-dépt pour la région). Depuis #306, la force
 * population du quadrant est le taux annuel pour mille
 * `taux_variation_population` (‰/an — le registre Démographie : delta / durée
 * / population moyenne × 1000) : les valeurs du fixture reprennent le contrat
 * R (signe identique au delta brut, qui reste publié pour le prose). Les
 * valeurs respectent l'invariant du contrat (sign(ratio − 1) = sign(delta))
 * et exercent les QUATRE lectures, cas de signes mélangés compris : 22002
 * grandit mais se densifie (ratio < 1, delta < 0), 200000002 se vide avec une
 * renaturation MESURÉE (artif_m3 < artif_m2, ratio < 1, delta < 0).
 */
export const histoiresMilieuxFixture: Histoire[] = [
  { territoire: '22001', type: 'commune', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2025', delta_population: 200, taux_variation_population: 14.4927536231884, artif_m2: 240, artif_m3: 300, artif_m2_par_habitant: 2250, artif_m3_par_habitant: 2550, trajectoire_artif_par_habitant: 1.1333333333333333, classification: 'grandir-en-setalant' },
  { territoire: '22002', type: 'commune', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2025', delta_population: 100, taux_variation_population: 13.3333333333333, artif_m2: 120, artif_m3: 129, artif_m2_par_habitant: 900, artif_m3_par_habitant: 855, trajectoire_artif_par_habitant: 0.95, classification: 'grandir-en-se-densifiant' },
  { territoire: '29001', type: 'commune', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2024', delta_population: -150, taux_variation_population: -8.26446280991736, artif_m2: 150, artif_m3: 155, artif_m2_par_habitant: 500, artif_m3_par_habitant: 530, trajectoire_artif_par_habitant: 1.06, classification: 'sen-aller-et-consommer-quand-meme' },
  { territoire: '29002', type: 'commune', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2024', delta_population: -10, taux_variation_population: -1.82149362477231, artif_m2: 100, artif_m3: 100.75, artif_m2_par_habitant: 400, artif_m3_par_habitant: 403, trajectoire_artif_par_habitant: 1.0075, classification: 'sen-aller-et-consommer-quand-meme' },
  { territoire: '200000001', type: 'epci', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2025', delta_population: 300, taux_variation_population: 14.0845070422535, artif_m2: 360, artif_m3: 435, artif_m2_par_habitant: 1500, artif_m3_par_habitant: 1750, trajectoire_artif_par_habitant: 1.1666666666666667, classification: 'grandir-en-setalant' },
  { territoire: '200000002', type: 'epci', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2024', delta_population: -160, taux_variation_population: -6.00600600600601, artif_m2: 250, artif_m3: 246, artif_m2_par_habitant: 420, artif_m3_par_habitant: 410, trajectoire_artif_par_habitant: 0.9761904761904762, classification: 'les-departs-laissent-la-place-a-la-renaturation' },
  { territoire: '22', type: 'departement', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2025', delta_population: 300, taux_variation_population: 14.0845070422535, artif_m2: 360, artif_m3: 435, artif_m2_par_habitant: 1500, artif_m3_par_habitant: 1750, trajectoire_artif_par_habitant: 1.1666666666666667, classification: 'grandir-en-setalant' },
  { territoire: '29', type: 'departement', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2024', delta_population: -160, taux_variation_population: -6.00600600600601, artif_m2: 250, artif_m3: 252, artif_m2_par_habitant: 420, artif_m3_par_habitant: 425, trajectoire_artif_par_habitant: 1.011904761904762, classification: 'sen-aller-et-consommer-quand-meme' },
  { territoire: '53', type: 'region', theme: 'milieux', story_key: 'se-densifier-setaler-ou-sen-aller', groupe: 'artificialisation', salience_reason: 'defaut', periode_pop: '2017-2023', periode_artif: '2021-2025 (22) · 2021-2024 (29)', delta_population: 140, taux_variation_population: 0.9, artif_m2: 610, artif_m3: 690, artif_m2_par_habitant: 750, artif_m3_par_habitant: 830, trajectoire_artif_par_habitant: 1.1066666666666667, classification: 'grandir-en-setalant' },
]

/**
 * Programmes fixture (issue #179, ADR-0013) — VALUES mirror the R-side
 * contract (theme_programmes.R / subventions.R), nothing invented: the five
 * sigles of MANIFEST_PROGRAMMES_COMPLET, the two anchor levels, the
 * « convention valant ORT » rider on the ACV label row (never a second ORT
 * row for that commune), the ORT rows carrying their per-row actualisation as
 * date_reference (publication null by contract), and the SCDL weekly vintage
 * on the subvention aggregates.
 */

/** Le vintage des labels/contrats ANCT — le tampon de SA source (manifest #175). */
const vintageAcv = {
  vintage_source:
    'ANCT — Programme Action cœur de ville : liste des communes sélectionnées (COG 2025)',
  vintage_version: '2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2025-09-24',
}

const vintagePvd = {
  vintage_source:
    'ANCT — Programme Petites villes de demain : liste des communes sélectionnées (COG 2025)',
  vintage_version: '2025',
  vintage_date_reference: '2025-01-01',
  vintage_date_publication: '2026-04-27',
}

const vintageCrte = {
  vintage_source:
    "ANCT — Contrat de relance et de transition écologique : suivi du périmètre (COG 2025), les groupements couverts par CRTE",
  vintage_version: '2025',
  vintage_date_reference: '2025-07-17',
  vintage_date_publication: '2025-09-24',
}

const vintageTi = {
  vintage_source:
    "ANCT/Banque des Territoires — liste des Territoires d'industrie et des communes concernées (les territoires arrêtés fin 2022)",
  vintage_version: '2022',
  vintage_date_reference: '2022-12-31',
  vintage_date_publication: '2025-09-30',
}

/** Le vintage ORT — la fraîcheur PAR LIGNE, publication null (manifest #175). */
const vintageOrt = {
  vintage_source:
    'DGALN/ANCT — Liste des communes couvertes par des opérations de revitalisation de territoire (ORT) : conventions signées (classeur XLSX, feuille « Suivi conventions »)',
  vintage_version: 'en continu',
  vintage_date_publication: null as string | null,
}

/**
 * Les lignes d'adhésion (ADR-0013) : ACV/PVD ancrées à la commune, CRTE/TI à
 * l'EPCI, ORT aux deux ancrages — la commune 29001 non labellisée et SON EPCI
 * (les lignes du fixture R : la convention signée porte les deux lignes). La
 * commune 22001 (ACV) porte le rider « convention valant ORT » sur SA ligne de
 * label, jamais une seconde ligne ORT. Triées par sigle (le tri R).
 */
export const membresProgrammesFixture: MembreProgramme[] = [
  // ACV — 22001 lauréate, rider « convention valant ORT » true
  { territoire: '22001', type: 'commune', sigle: 'ACV', convention_valant_ort: true, ...vintageAcv },
  // PVD — 22002 lauréate, sans rider
  { territoire: '22002', type: 'commune', sigle: 'PVD', convention_valant_ort: false, ...vintagePvd },
  // CRTE — l'EPCI X signataire
  { territoire: '200000001', type: 'epci', sigle: 'CRTE', convention_valant_ort: false, ...vintageCrte },
  // Territoires d'industrie — l'EPCI Y
  { territoire: '200000002', type: 'epci', sigle: "Territoires d'industrie", convention_valant_ort: false, ...vintageTi },
  // ORT — la commune 29001 non labellisée + son EPCI, actualisation par ligne
  { territoire: '29001', type: 'commune', sigle: 'ORT', convention_valant_ort: false, ...vintageOrt, vintage_date_reference: '2026-07-15' },
  { territoire: '200000002', type: 'epci', sigle: 'ORT', convention_valant_ort: false, ...vintageOrt, vintage_date_reference: '2026-07-15' },
]

/** Le vintage hebdomadaire SCDL — la source de référence des agrégats (#176). */
const vintageSubventions = {
  vintage_source:
    'Région Bretagne — subventions attribuées (SCDL), data.bretagne.bzh, rafraîchi chaque semaine',
  vintage_version: '2026-08-05',
  vintage_date_reference: '2026-08-05',
  vintage_date_publication: '2026-08-05',
}

/**
 * Les agrégats de subventions (ADR-0013, #176, contrat révisé #305) : les
 * lignes communales portent la ventilation COMPLÈTE par domaine (programme_libl
 * + montant — le pipeline publie chaque domaine, plus jamais de ligne
 * « autres »), les lignes EPCI / département / région le total annuel unique
 * (programme_libl null). L'année de référence 2025 (la plus récente complète).
 * Triées par type puis territoire (le tri R) — mais les AXES d'une commune
 * sont DÉLIBÉRÉMENT dans l'ordre du payload R (non triés) : le tri décroissant
 * est l'affaire de l'app (issue #305), le fixture doit pouvoir le débusquer.
 */
export const subventionsProgrammesFixture: SubventionProgramme[] = [
  { territoire: '22001', type: 'commune', annee: 2025, programme_libl: 'Agriculture', montant: 15000, ...vintageSubventions },
  { territoire: '22001', type: 'commune', annee: 2025, programme_libl: 'Développement économique', montant: 30000, ...vintageSubventions },
  { territoire: '200000001', type: 'epci', annee: 2025, programme_libl: null, montant: 45000, ...vintageSubventions },
  { territoire: '22', type: 'departement', annee: 2025, programme_libl: null, montant: 300000, ...vintageSubventions },
  { territoire: '53', type: 'region', annee: 2025, programme_libl: null, montant: 2000000, ...vintageSubventions },
]

/** Le payload programmes complet — l'objet { membres, subventions } du contrat. */
export const programmesFixture: ProgrammesPayload = {
  membres: membresProgrammesFixture,
  subventions: subventionsProgrammesFixture,
}

/** Le payload programmes vide — l'état honnête quand le fichier est absent. */
export const programmesVideFixture: ProgrammesPayload = {
  membres: [],
  subventions: [],
}

/**
 * La DÉRIVATION EN ÉCHELLE (issue #181) — le fixture de l'échelle qui étend le
 * fixture partagé avec le cas transversal verrouillé par le PRD #162 : un EPCI
 * CROSS-DÉPARTEMENT (modèle du réel — Redon Agglomération, 35+56 : ses communes
 * s'étendent sur deux départements, sa ligne de référence ne porte QUE son
 * département « maison »). L'EPCI Z (200000003) porte la commune 22003
 * (département 22 — « Commune E », le nom du fixture R) et la commune 29003
 * (département 29 — « Commune F »). La dérivation compte les EPCIs d'un
 * département par l'APPARTENANCE de ses communes (les `epci` distincts des
 * communes du département), jamais par le champ `departement` de la ligne EPCI
 * — un EPCI transversal compte dans les DEUX départements. Les lignes
 * d'adhésion étendent le fixture : l'EPCI Z signe un CRTE (le contrat compte
 * dans 22 ET 29), ses deux communes non labellisées portent une convention ORT
 * signée (lignes commune + EPCI Z). La ventilation des subventions de la
 * commune 29003 est LARGE (7 domaines — la forme du contrat révisé #305 : la
 * ventilation COMPLÈTE par domaine, jamais de ligne « autres »), DÉLIBÉRÉMENT
 * non triée (l'app trie par montant décroissant, le fixture doit pouvoir le
 * débusquer), avec l'égalité 6 000 € (Enseignement / Tourisme) qui exerce le
 * départage par libellé. La commune 22003 porte sa propre ligne (Insertion) —
 * le total agrégé de l'EPCI Z (172 000) = la somme des deux communes, et la
 * part de contexte de 29003 n'est pas dégénérée. La commune 29001 porte une
 * ligne sans total agrégé pour SON EPCI (Y) — la part de contexte silencieuse.
 * Rien d'inventé — les valeurs suivent les conventions verrouillées côté R
 * (ADR-0013, #176).
 */

/** Le référentiel de l'échelle : le fixture partagé + l'EPCI Z transversal et ses deux communes. */
export const territoiresLadderFixture: Territoire[] = [
  ...territoiresFixture,
  { territoire: '22003', type: 'commune', nom: 'Commune E', departement: '22', epci: '200000003' },
  { territoire: '29003', type: 'commune', nom: 'Commune F', departement: '29', epci: '200000003' },
  // L'EPCI transversal — comme Redon Agglomération : son champ `departement`
  // est SON département « maison » (le préfixe du SIREN), jamais une
  // appartenance exclusive — la dérivation ne le lit pas.
  { territoire: '200000003', type: 'epci', nom: 'EPCI Z', departement: '22', epci: null },
]

/**
 * Les lignes d'adhésion de l'échelle : le fixture partagé + le CRTE de l'EPCI Z
 * (transversal — compte dans les deux départements) + les conventions ORT
 * signées des communes non labellisées 22003 et 29003, aux deux ancrages
 * (commune + EPCI Z — le référentiel commune → EPCI du calcul R).
 */
export const membresLadderFixture: MembreProgramme[] = [
  ...membresProgrammesFixture,
  { territoire: '200000003', type: 'epci', sigle: 'CRTE', convention_valant_ort: false, ...vintageCrte },
  { territoire: '22003', type: 'commune', sigle: 'ORT', convention_valant_ort: false, ...vintageOrt, vintage_date_reference: '2026-07-20' },
  { territoire: '29003', type: 'commune', sigle: 'ORT', convention_valant_ort: false, ...vintageOrt, vintage_date_reference: '2026-07-21' },
  { territoire: '200000003', type: 'epci', sigle: 'ORT', convention_valant_ort: false, ...vintageOrt, vintage_date_reference: '2026-07-21' },
]

/**
 * Les agrégats de subventions de l'échelle : le fixture partagé + la ventilation
 * LARGE COMPLÈTE de la commune 29003 (7 domaines, non triée — le tri est
 * l'affaire de l'app, #305), la ligne propre de la commune 22003, la ligne
 * sans total agrégé de la commune 29001 (la part de contexte silencieuse) et
 * le total unique de l'EPCI Z (172 000 = 162 000 + 10 000, la somme de ses
 * communes).
 */
export const subventionsLadderFixture: SubventionProgramme[] = [
  ...subventionsProgrammesFixture,
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Culture', montant: 30000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Environnement', montant: 10000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Développement économique', montant: 50000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Tourisme', montant: 6000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Agriculture', montant: 40000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Sport', montant: 20000, ...vintageSubventions },
  { territoire: '29003', type: 'commune', annee: 2025, programme_libl: 'Enseignement', montant: 6000, ...vintageSubventions },
  { territoire: '22003', type: 'commune', annee: 2025, programme_libl: 'Insertion', montant: 10000, ...vintageSubventions },
  { territoire: '29001', type: 'commune', annee: 2025, programme_libl: 'Environnement', montant: 25000, ...vintageSubventions },
  { territoire: '200000003', type: 'epci', annee: 2025, programme_libl: null, montant: 172000, ...vintageSubventions },
]

/** Le payload programmes de l'échelle — l'objet { membres, subventions } complet. */
export const programmesLadderFixture: ProgrammesPayload = {
  membres: membresLadderFixture,
  subventions: subventionsLadderFixture,
}


/**
 * The per-file charger built from a full fixture payload � the T2 test seam
 * (issue #298) : `PAYLOAD_CHARGER_KEY` becomes per-file, so component specs
 * drive the progressive store by injecting a charger that maps each file name
 * to its fixture section. A theme absent from the payload returns null (the
 * � 404 = table absente � contract, ADR-0013), so a fixture carrying only
 * demographie renders exactly one theme � the payload-driven tab bar
 * (ADR-0007) stays honest.
 */
export function chargerAvec(payload: Payload): (fichier: Fichier) => Promise<unknown> {
  return async (fichier: Fichier) => {
    switch (fichier) {
      case 'territoires':
        return payload.territoires
      case 'run-report':
        return payload.runReport
      case 'vintages':
        return payload.vintages
      case 'apercu':
        return payload.apercu
      case 'programmes':
        return payload.programmes
      default:
        if (fichier.startsWith('indicateurs_')) {
          const theme = fichier.slice('indicateurs_'.length) as Theme
          const lignes = payload.indicateurs.filter((l) => l.theme === theme)
          return lignes.length > 0 ? lignes : null
        }
        if (fichier.startsWith('histoires_')) {
          const theme = fichier.slice('histoires_'.length) as Theme
          const lignes = payload.histoires.filter((l) => l.theme === theme)
          return lignes.length > 0 ? lignes : null
        }
        const theme = fichier.slice('theme_'.length) as Theme
        const declaree = payload.themeMetadata?.[theme]
        if (declaree) return declaree
        // La présence du thème (des faits) implique SES métadonnées — le
        // contrat #313 : le fixture sert alors la métadonnée canonique,
        // comme le loader l'exige d'un thème présent.
        const presente = payload.indicateurs.some((l) => l.theme === theme)
        return presente ? metadonneesThemesFixtures[theme] : null
    }
  }
}

/**
 * Les fixtures VALIDES du contrat theme_<theme>.json (issue #309) — le miroir
 * TypeScript des fixtures R (pipeline/tests/testthat/fixtures/theme-metadata/).
 * Un sous-groupe par histoire résolue (la bijection du contrat) : Démographie,
 * Habitat, Milieux et Mobilité ont une story unique → un sous-groupe ;
 * Économie a deux stories → deux sous-groupes (l'ordre des sous-groupes est
 * l'ordre de la fiche). Les clés d'indicateurs, les story_keys et les sources
 * de référence reprennent les registres réels des thèmes construits.
 * Programmes n'a PAS de fixture ici : c'est un contrat de publication séparé,
 * jamais un thème.
 */
export const metadonneesThemesFixtures: Record<Theme, ThemeMetadata> = {
  demographie: {
    theme: 'demographie',
    label: 'Démographie',
    subgroups: [
      {
        key: 'etat-et-dynamique',
        label: 'État et dynamique de la population',
        framing: 'La population de la commune : sa taille, sa densité, son évolution depuis 1968 et la structure de ses ménages.',
        indicators: ['densite', 'structure_age', 'evolution_1968', 'taille_menages'],
        figure: { family: 'composition', indicator: 'structure_age' },
        reading: {
          story_key: 'trajectoire-demographique',
          params: ['periode', 'taux_solde_naturel', 'taux_solde_migratoire', 'classification'],
          template: [
            { type: 'text', content: 'Entre ' },
            { type: 'param', key: 'periode' },
            { type: 'text', content: ', la population de ' },
            { type: 'territoire' },
            { type: 'text', content: ' ' },
            { type: 'strong', children: [{ type: 'param', key: 'classification' }] },
            { type: 'text', content: ' : ' },
            { type: 'param', key: 'taux_solde_naturel' },
            { type: 'text', content: ' par an (naturel), ' },
            { type: 'param', key: 'taux_solde_migratoire' },
            { type: 'text', content: ' (migratoire). ' },
            {
              type: 'link',
              href: '/methodologie#demographie',
              children: [{ type: 'text', content: 'Sources et méthodes' }],
            },
          ],
        },
      },
    ],
    indicator_keys: ['densite', 'structure_age', 'evolution_1968', 'taille_menages'],
    story_keys: ['trajectoire-demographique'],
    sources: {
      densite: 'serie_historique',
      structure_age: 'age_detail',
      evolution_1968: 'serie_historique',
      taille_menages: 'menages',
    },
    indicator_labels: {
      densite: 'Densité de population',
      structure_age: 'Structure par âge',
      evolution_1968: 'Évolution de la population depuis 1968',
      taille_menages: 'Taille moyenne des ménages',
    },
    detail_labels: {
      structure_age: {
        '<15': 'Moins de 15 ans',
        '15-24': '15 à 24 ans',
        '25-39': '25 à 39 ans',
        '40-54': '40 à 54 ans',
        '55-64': '55 à 64 ans',
        '65-79': '65 à 79 ans',
        '80+': '80 ans et plus',
      },
    },
    param_labels: {
      periode: 'Période',
      taux_solde_naturel: 'Solde naturel (‰/an)',
      taux_solde_migratoire: 'Solde migratoire (‰/an)',
      classification: 'Classification',
    },
    classification_labels: {
      'attire-renouvelle': 'attire et se renouvelle',
      'attire-meurt': 'attire, mais se meurt',
      'vide-meurt': 'se vide et se meurt',
      'vide-renouvelle': 'se vide, mais se renouvelle',
    },
  },
  habitat: {
    theme: 'habitat',
    label: 'Habitat',
    subgroups: [
      {
        key: 'etat-du-parc',
        label: 'L\u2019état du parc',
        framing: 'Le parc de logements de la commune : sa composition, son statut, son âge, son type, son prix et son efficacité énergétique.',
        indicators: ['mix_logements', 'statut', 'age_du_bati', 'type', 'prix_m2', 'part_passoires', 'distribution_dpe'],
        figure: { family: 'composition', indicator: 'distribution_dpe' },
        reading: {
          story_key: 'etat-energetique-du-parc',
          params: ['classification', 'part_passoires', 'part_abc', 'n_dpe'],
          template: [
            { type: 'text', content: 'Le parc de ' },
            { type: 'territoire' },
            { type: 'text', content: ' est ' },
            { type: 'strong', children: [{ type: 'param', key: 'classification' }] },
            { type: 'text', content: ' : ' },
            { type: 'param', key: 'part_passoires' },
            { type: 'text', content: ' de passoires thermiques. ' },
            {
              type: 'link',
              href: '/methodologie#habitat',
              children: [{ type: 'text', content: 'Sources et méthodes' }],
            },
          ],
        },
      },
    ],
    indicator_keys: ['mix_logements', 'statut', 'age_du_bati', 'type', 'prix_m2', 'part_passoires', 'distribution_dpe'],
    story_keys: ['etat-energetique-du-parc'],
    sources: {
      mix_logements: 'logements',
      statut: 'logements',
      age_du_bati: 'logements',
      type: 'logements',
      prix_m2: 'dvf_2025_dep22',
      part_passoires: 'dpe_22',
      distribution_dpe: 'dpe_22',
    },
    indicator_labels: {
      mix_logements: 'Mix de logements',
      statut: 'Statut d’occupation',
      age_du_bati: 'Âge du bâti',
      type: 'Type de logement',
      prix_m2: 'Médiane prix au m²',
      part_passoires: 'Part de passoires thermiques',
      distribution_dpe: 'Distribution des étiquettes DPE (A à G)',
    },
    detail_labels: {
      mix_logements: {
        principales: 'Résidences principales',
        secondaires: 'Résidences secondaires',
        vacants: 'Logements vacants',
      },
      statut: {
        proprietaire: 'Propriétaires',
        hlm: 'Locataires HLM (parc social)',
        locataire_prive: 'Locataires du parc privé',
        loge_gratuit: 'Logés gratuitement',
      },
      age_du_bati: {
        lt1919: 'Avant 1919',
        '1919_1945': 'De 1919 à 1945',
        '1946_1970': 'De 1946 à 1970',
        '1971_1990': 'De 1971 à 1990',
        '1991_2005': 'De 1991 à 2005',
        '2006_plus': 'De 2006 à aujourd’hui',
      },
      type: {
        maison: 'Maisons',
        appartement: 'Appartements',
      },
      prix_m2: {
        '2021': '2021',
        '2022': '2022',
        '2023': '2023',
        '2024': '2024',
        '2025': '2025',
      },
      distribution_dpe: {
        A: 'A',
        B: 'B',
        C: 'C',
        D: 'D',
        E: 'E',
        F: 'F',
        G: 'G',
      },
    },
    param_labels: {
      classification: 'Classification',
      part_passoires: 'Part de passoires thermiques',
      part_abc: 'Part des étiquettes A/B/C',
      n_dpe: 'Nombre de DPE recensés',
    },
    classification_labels: {
      'parc-performant': 'performant',
      'parc-intermediaire': 'intermédiaire',
      'passoire-energetique': 'une passoire énergétique',
      'parc-heterogene': 'hétérogène',
    },
  },
  economie: {
    theme: 'economie',
    label: 'Économie/Emploi',
    subgroups: [
      {
        key: 'sante-et-taille',
        label: 'Santé et taille du tissu productif',
        framing: 'La santé du tissu productif local : l\u2019emploi salarié au lieu de travail et le chômage au sens du recensement.',
        indicators: ['effectifs_salaries', 'chomage'],
        figure: { family: 'scalar', indicator: 'effectifs_salaries' },
        reading: {
          story_key: 'ce-que-la-commune-abrite',
          figure: { family: 'list', indicator: 'lq' },
          params: ['rang', 'activity_label', 'lq', 'n'],
          template: [
            { type: 'text', content: 'La commune se spécialise dans ' },
            { type: 'strong', children: [{ type: 'param', key: 'activity_label' }] },
            { type: 'text', content: ' (rang ' },
            { type: 'param', key: 'rang' },
            { type: 'text', content: ' du top 5). ' },
            {
              type: 'link',
              href: '/methodologie#economie',
              children: [{ type: 'text', content: 'Sources et méthodes' }],
            },
          ],
        },
      },
      {
        key: 'structure-verte',
        label: 'La structure verte',
        framing: 'La place des établissements verts dans le tissu productif.',
        indicators: ['eco_activites'],
         figure: { family: 'scalar', indicator: 'eco_activites' },
      },
    ],
    indicator_keys: ['effectifs_salaries', 'chomage', 'eco_activites'],
     story_keys: ['ce-que-la-commune-abrite'],
    sources: {
      effectifs_salaries: 'flores_a88',
      chomage: 'rp_chomage',
      eco_activites: 'sirene_snapshot',
    },
    indicator_labels: {
      effectifs_salaries: 'Effectifs salariés (lieu de travail)',
      chomage: 'Chômage (population active)',
      eco_activites: 'Part des éco-activités',
    },
    detail_labels: {},
    param_labels: {
      rang: 'Rang',
      activity_label: 'Activité dominante',
      lq: 'Location quotient (LQ)',
      n: 'Nombre d’établissements',
    },
  },
  milieux: {
    theme: 'milieux',
    label: 'Milieux',
    subgroups: [
      {
        key: 'artificialisation',
        label: 'L\u2019artificialisation',
        framing: 'La consommation de la terre par l\u2019urbanisation : l\u2019état artificialisé et le flux annuel.',
        indicators: ['artif_par_habitant', 'conso_enaf_annuel'],
        figure: { family: 'trajectory', indicator: 'artif_par_habitant' },
        reading: {
          story_key: 'se-densifier-setaler-ou-sen-aller',
          params: ['periode_pop', 'periode_artif', 'delta_population', 'trajectoire_artif_par_habitant', 'classification'],
          template: [
            { type: 'text', content: 'Entre ' },
            { type: 'param', key: 'periode_pop' },
            { type: 'text', content: ' et ' },
            { type: 'param', key: 'periode_artif' },
            { type: 'text', content: ', ' },
            { type: 'territoire' },
            { type: 'text', content: ' ' },
            { type: 'strong', children: [{ type: 'param', key: 'classification' }] },
            { type: 'text', content: ' (trajectoire ' },
            { type: 'param', key: 'trajectoire_artif_par_habitant' },
            { type: 'text', content: ' par habitant). ' },
            {
              type: 'link',
              href: '/methodologie#milieux',
              children: [{ type: 'text', content: 'Sources et méthodes' }],
            },
          ],
        },
      },
    ],
    indicator_keys: ['artif_par_habitant', 'conso_enaf_annuel'],
    story_keys: ['se-densifier-setaler-ou-sen-aller'],
    sources: {
      artif_par_habitant: 'ocsge_artificialisation_22_2025',
      conso_enaf_annuel: 'consoenaf',
    },
    indicator_labels: {
      artif_par_habitant: 'Intensité état',
      conso_enaf_annuel: 'Consommation d’ENAF — série annuelle',
    },
    detail_labels: {
      artif_par_habitant: {
        M2: 'État initial (M2)',
        M3: 'État final (M3)',
        '2020': '2020',
        '2021': '2021',
        '2022': '2022',
        '2023': '2023',
        '2024': '2024',
        '2025': '2025',
      },
      conso_enaf_annuel: {
        '2011': '2011',
        '2012': '2012',
        '2013': '2013',
        '2014': '2014',
        '2015': '2015',
        '2016': '2016',
        '2017': '2017',
        '2018': '2018',
        '2019': '2019',
        '2020': '2020',
        '2021': '2021',
        '2022': '2022',
        '2023': '2023',
        '2024': '2024',
      },
    },
    param_labels: {
      periode_pop: 'Période de population',
      periode_artif: 'Période des états OCS-GE',
      delta_population: 'Variation de population',
      trajectoire_artif_par_habitant: 'Trajectoire par habitant',
      classification: 'Classification',
    },
    classification_labels: {
      'grandir-en-se-densifiant': 'grandit en se densifiant',
      'grandir-en-setalant': "grandit en s'étalant",
      'sen-aller-et-consommer-quand-meme': 'se vide, et consomme quand même',
      'les-departs-laissent-la-place-a-la-renaturation': 'se vide, laissant la place à la renaturation',
    },
  },
  mobilite: {
    theme: 'mobilite',
    label: 'Mobilité',
    subgroups: [
      {
        key: 'acces-aux-services',
        label: 'L\u2019accès aux services',
        framing: 'Ce que les bâtiments de la commune peuvent atteindre à pied ou en transports en commun, et l\u2019offre de transport qui le permet.',
        indicators: [
          'voitures_menage',
          'reseaux',
          'offre_tc',
          'bornes_recharge',
          'places_stationnement_velo_1000',
          'offre_cyclable',
          'iso_alimentation',
          'iso_sante',
          'iso_administration',
          'iso_ecole',
          'iso_banque',
        ],
        figure: { family: 'scalar', indicator: 'offre_cyclable' },
        reading: {
          story_key: 'vingt-minutes-sans-voiture',
          params: ['div_loss_t', 'pct_iso_full_t', 'classification_saillance'],
          template: [
            { type: 'text', content: 'Sans voiture, ' },
            { type: 'param', key: 'div_loss_t' },
            { type: 'text', content: ' types de services disparaissent de l\u2019accès quotidien de ' },
            { type: 'territoire' },
            { type: 'text', content: '. ' },
            {
              type: 'link',
              href: '/methodologie#mobilite',
              children: [{ type: 'text', content: 'Sources et méthodes' }],
            },
          ],
        },
      },
    ],
    indicator_keys: [
      'voitures_menage',
      'reseaux',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
      'offre_cyclable',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ],
    story_keys: ['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'],
    sources: {
      voitures_menage: 'rp_logement_princ',
      reseaux: 'amenagements_cyclables',
      offre_tc: 'korrigo',
      bornes_recharge: 'bornes-recharges',
      places_stationnement_velo_1000: 'stationnement-velo',
      offre_cyclable: 'osm_reseaux',
      iso_alimentation: 'mobilite_snapshot',
      iso_sante: 'mobilite_snapshot',
      iso_administration: 'mobilite_snapshot',
      iso_ecole: 'mobilite_snapshot',
      iso_banque: 'mobilite_snapshot',
    },
    indicator_labels: {
      iso_alimentation: 'Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)',
      iso_sante: 'Part des bâtiments sans accès à la santé (à pied ou en transports en commun)',
      iso_administration: 'Part des bâtiments sans accès aux services administratifs (à pied ou en transports en commun)',
      iso_ecole: 'Part des bâtiments sans accès à l’école (à pied ou en transports en commun)',
      iso_banque: 'Part des bâtiments sans accès à la banque (à pied ou en transports en commun)',
      voitures_menage: 'Voitures par ménage',
      reseaux: 'Réseaux à pied / vélo / voiture',
      offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)',
      bornes_recharge: 'Bornes de recharge pour véhicules électriques',
      places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
      offre_cyclable: 'L’offre cyclable',
    },
    detail_labels: {
      reseaux: {
        t_longueur: 'Longueur — à pied ou en transports en commun',
        t_densite: 'Densité — à pied ou en transports en commun',
        b_longueur: 'Longueur — à vélo',
        b_densite: 'Densité — à vélo',
        c_longueur: 'Longueur — en voiture',
        c_densite: 'Densité — en voiture',
      },
      voitures_menage: {
        sans_voiture: 'Ménages sans voiture',
        une_voiture: 'Ménages avec 1 voiture',
        deux_plus: 'Ménages avec 2 voitures ou plus',
      },
      offre_cyclable: {
        protege_longueur: 'Longueur protégée',
        protege_km_1000: 'Protégé',
        partage_longueur: 'Longueur partagée',
        partage_km_1000: 'Partagé',
        total_longueur: 'Longueur totale',
      },
    },
    param_labels: {
      div_loss_t: 'Types de services perdus à pied ou en transports en commun',
      pct_iso_full_t: 'Part des bâtiments perdant tout accès',
      classification_saillance: 'Classification de saillance',
    },
  },
}
