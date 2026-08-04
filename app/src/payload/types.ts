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

/** One facts row per (territoire × key × detail). */
export interface Indicateur {
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
  vintage_source: string
  vintage_version: string
  /** Null when the source has no reference date (the DPE rolling base — pipeline spec #12). */
  vintage_date_reference: string | null
  vintage_date_publication: string | null
}

/**
 * One story row per territoire. The pipeline's single `histoires` table is
 * theme-specific: Démographie (« Attractive ou fertile ? ») publishes the
 * soldes, Habitat (« L'état énergétique du parc ») publishes the DPE parts —
 * the columns of the other theme are absent from the row. The app mirrors
 * that: the common fields are required, the per-theme fields optional.
 */
export interface Histoire {
  territoire: string
  type: TerritoireType
  theme: Theme
  story_key: string
  /** Null = lecture impossible (échantillon DPE trop petit) — jamais inventée. */
  classification: string | null
  /** Démographie — les soldes du « Attractive ou fertile ? ». */
  solde_naturel?: number | null
  solde_migratoire?: number | null
  /** Habitat — les parts du « L'état énergétique du parc ». */
  part_passoires?: number | null
  part_abc?: number | null
  n_dpe?: number | null
}

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

/** The assembled payload — everything the app renders, parsed and validated. */
export interface Payload {
  territoires: Territoire[]
  indicateurs: Indicateur[]
  histoires: Histoire[]
  apercu: ApercuRow[]
  runReport: RunReport | null
}
