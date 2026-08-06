/**
 * The fiche payload — the TS mirror of the pipeline contract
 * (docs/architecture.md §The fiche payload, R-side test-contract-payload.R).
 *
 * These interfaces match the JSON projections published to public/data/
 * (indicateurs_<theme>.json, histoires_<theme>.json, territoires.json,
 * apercu.json, run-report.json) field for field. They are the app's half of
 * validate_payload(): drift on the pipeline side must surface here as a
 * loud type/validation error, never as silent wrong figures.
 *
 * Semantics locked by the contract:
 * - ranks are fractions in [0,1] (0.25, not 25); null = no comparison group
 *   at that level
 * - value null = not computable for that territory
 * - keys of unbuilt themes are ABSENT from apercu (not null)
 * - two vintage dates per indicator: reference + publication
 * - territoires.epci is the SIREN for communes, null otherwise
 */

/** The four themes, in canonical order (ADR-0007 — payload-driven tabs). */
export const THEMES_CANONIQUES = [
  'mobilite',
  'demographie',
  'habitat',
  'economie',
] as const

export type Theme = (typeof THEMES_CANONIQUES)[number]

export type TerritoireType = 'commune' | 'epci' | 'departement' | 'region'

/** The rank-in-context columns of the indicateurs table. */
export type ColonneRang = 'rang_epci' | 'rang_dep' | 'rang_reg'

/** Reference table — one row per territory, the real names (LIBGEO/LIBEPCI). */
export interface Territoire {
  territoire: string
  type: TerritoireType
  nom: string
  departement: string | null
  epci: string | null
}

/**
 * The four vintage columns every dated row of the payload carries (indicateurs
 * AND the Économie Stories — issue #120): source · version · the two ISO dates
 * (the reference null for a rolling base, ADR-0009). The stamp pattern the
 * fiche's freshness promise reads (formaterVintage, selectors.ts).
 */
export interface VintageStamp {
  vintage_source: string
  vintage_version: string
  /** The reference date — null for a rolling base (DPE: ADR-0009, spec #12). */
  vintage_date_reference: string | null
  vintage_date_publication: string
}

/** One facts row per (territoire × key × detail). */
export interface Indicateur extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: Theme
  key: string
  detail: string | null
  value: number | null
  unit: string
  rang_epci: number | null
  rang_dep: number | null
  rang_reg: number | null
}

/**
 * The Story row per territoire (schema name kept: histoires) — the shape is
 * theme-specific (the R contract: Démographie carries the two soldes, Habitat
 * the parc-reading parts). Discriminated by `theme`.
 */
export interface HistoireDemographie {
  territoire: string
  type: TerritoireType
  theme: 'demographie'
  story_key: string
  solde_naturel: number
  solde_migratoire: number
  /** Annualized per-mille rates (ADR-0011) — the two forces the reading crosses. */
  taux_solde_naturel: number
  taux_solde_migratoire: number
  classification: string
  /**
   * The inter-censal window the rates annualize ("2017-2023") — dates the
   * story title. Null until the pipeline publishes it (issue #113): the
   * undated title is the honest fallback, never an invented period.
   */
  periode: string | null
}

export interface HistoireHabitat {
  territoire: string
  type: TerritoireType
  theme: 'habitat'
  story_key: string
  /** Classification + parts de justification null sous le seuil n < 30 (suppression, R contract). */
  classification: string | null
  part_passoires: number | null
  part_abc: number | null
  n_dpe: number
}

/**
 * The Économie Story row (issue #120) — MULTI-LIGNES: 1 à 5 lignes par
 * (territoire × story_key), le top-5 de la lecture. Discriminé par `story_key` :
 * « ce que la commune abrite » (la spécialisation LQ, communes/EPCIs/
 * départements) et « ce que la Bretagne abrite » (la lecture de structure de la
 * région — sa LQ est dégénérée, elle lit la présence). Le label d'activité
 * vient TOUJOURS du payload (`activity_label`), jamais codé en dur. Chaque ligne
 * porte son estampille vintage (issue #74) : deux dates ISO + source/version.
 */
export interface HistoireEconomieCommuneAbrite extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: 'economie'
  story_key: 'ce-que-la-commune-abrite'
  /** Le rang dans le top-5 du territoire (1–5, un rang par ligne). */
  rang: number
  /** La sous-classe NAF rév. 2 (APE 5 chiffres + lettre) — l'identité de l'activité. */
  activity_code: string
  activity_label: string
  /** La spécialisation (LQ vs la moyenne bretonne, même échelle) — la matière de la lecture. */
  lq: number
  /** Les établissements actifs derrière le rang. */
  n: number
  /** La part du parc breton — hors de cette lecture (null par contrat). */
  part_parc: number | null
}

export interface HistoireEconomieBretagneAbrite extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: 'economie'
  story_key: 'ce-que-la-bretagne-abrite'
  rang: number
  activity_code: string
  activity_label: string
  /** La LQ est dégénérée pour la région (elle EST la référence) — null par contrat. */
  lq: number | null
  n: number
  /** La part du parc breton — la matière de la lecture de structure. */
  part_parc: number
}

export type HistoireEconomie = HistoireEconomieCommuneAbrite | HistoireEconomieBretagneAbrite

export type Histoire = HistoireDemographie | HistoireHabitat | HistoireEconomie

/** One basic-stat row per (territoire × key) — the Aperçu tab renders it, never derives it. */
export interface ApercuRow {
  territoire: string
  type: TerritoireType
  key: string
  value: number | null
  unit: string
}

export type ModeSource = 'cron' | 'manuel'
export type StatutSource = 'frais' | 'échec' | 'à traiter à la main'

/** One dataset's record in the run report (CONTEXT.md §Run report). */
export interface StatutRun {
  id: string
  mode: ModeSource
  status: StatutSource
}

/** The per-run record committed alongside the payload (run-report.json). */
export interface RunReport {
  mode: string
  timestamp: string
  statuts: StatutRun[]
}

/** One dataset's vintage record (vintages.json — the shared source table). */
export interface Vintage {
  id: string
  source: string
  version: string
  licence: string
  date_reference: string | null
  date_publication: string | null
}

/** The assembled payload — everything the app renders, parsed and validated. */
export interface Payload {
  territoires: Territoire[]
  indicateurs: Indicateur[]
  histoires: Histoire[]
  apercu: ApercuRow[]
  runReport: RunReport | null
  /** The shared vintage table (vintages.json) — optional, like run-report. */
  vintages: Vintage[] | null
}
