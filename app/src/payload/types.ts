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
  'milieux',
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

/**
 * The Mobilité Story rows (issue #142, ADR-0012) — TWO rows per saillant
 * territory at most: the always-on default « vingt-minutes-sans-voiture » and,
 * ONLY where the bike delta is real (classification « saillant »), the salience
 * candidate « ce-que-le-velo-preserve ». The default row carries the story's
 * whole matter: the reading (div_loss_t — the number of service types that
 * leave the territory's reach à pied ou en transports en commun at 20 minutes),
 * the story depth (pct_iso_full_t — the share of buildings that lose ALL
 * access), the precomputed distribution signature (dens_1..10 + dec_1..10 +
 * min/max — the building-level density of div_loss_t, NEVER the matrix,
 * lesson of issue #131) and the saillance classification. The vélo row carries
 * only the delta reading — the distribution is hors contrat there (null in the
 * raw rows, dropped from the type). Each row carries the snapshot's vintage
 * stamp (issue #74 — the flagship cites its source).
 */
export interface HistoireMobiliteVingtMinutes extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: 'mobilite'
  story_key: 'vingt-minutes-sans-voiture'
  /** La lecture — les types de services perdus à pied ou en transports en commun à 20 min. */
  div_loss_t: number
  div_loss_b: number
  /** La matière de la saillance — ce que le vélo préserve déjà (div_loss_t − div_loss_b). */
  delta: number
  /** La part des bâtiments qui perdent TOUT accès — la profondeur du Story. */
  pct_iso_full_t: number | null
  dens_min: number | null
  dens_max: number | null
  dens_1: number | null
  dens_2: number | null
  dens_3: number | null
  dens_4: number | null
  dens_5: number | null
  dens_6: number | null
  dens_7: number | null
  dens_8: number | null
  dens_9: number | null
  dens_10: number | null
  dec_1: number | null
  dec_2: number | null
  dec_3: number | null
  dec_4: number | null
  dec_5: number | null
  dec_6: number | null
  dec_7: number | null
  dec_8: number | null
  dec_9: number | null
  dec_10: number | null
  classification_saillance: string
}

/** La lecture du delta — le vélo préserve déjà ces types de services (réalisé, jamais potentiel). */
export interface HistoireMobiliteVeloPreserve extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: 'mobilite'
  story_key: 'ce-que-le-velo-preserve'
  div_loss_t: number
  div_loss_b: number
  delta: number
  /** Le vélo ne se déclenche que sur la saillance — « saillant » par contrat. */
  classification_saillance: 'saillant'
}

export type HistoireMobilite = HistoireMobiliteVingtMinutes | HistoireMobiliteVeloPreserve

/**
 * The Milieux Story row (issue #174, ADR-0014) — « Se densifier, s'étaler, ou
 * s'en aller », the single Story of the fifth theme: ONE row per territory,
 * the reading by the SIGNS alone (threshold 0 — ZAN is a zero-objective, the
 * data is a complete census: a 0 is a real 0). The two forces: Δpopulation
 * (from the Démographie série historique — the population-sourcing rule of
 * ADR-0014, never CONSOENAF's embedded fields) and the window consumption
 * (the CONSOENAF annuals re-summed on the SAME window — the two-clocks rule:
 * the window derives from the RP millésimes the série holds, "2017-2023"
 * today, never hardcoded). The intensity (m² of ENAF per added inhabitant) is
 * published only when Δpopulation is meaningfully positive (SEUIL_INTENSITE);
 * classification null = incomplete window (never an invented reading).
 */
export interface HistoireMilieux {
  territoire: string
  type: TerritoireType
  theme: 'milieux'
  story_key: 'se-densifier-setaler-ou-sen-aller'
  /** La fenêtre dérivée de la série historique — la date du titre, jamais codée en dur. */
  periode: string
  delta_population: number
  conso_fenetre: number
  intensite_m2_par_habitant: number | null
  classification: string | null
}

export type Histoire = HistoireDemographie | HistoireHabitat | HistoireEconomie | HistoireMobilite | HistoireMilieux

/** One basic-stat row per (territoire × key) — the Aperçu tab renders it, never derives it. */
export interface ApercuRow {
  territoire: string
  type: TerritoireType
  key: string
  value: number | null
  unit: string
}

/**
 * The programme sigles of the payload contract (ADR-0013, the ANCT/DGALN
 * sources of the MANIFEST_PROGRAMMES_COMPLET): the two commune labels (ACV,
 * PVD), the two EPCI contracts (CRTE, Territoires d'industrie) and the ORT
 * tool-badge (commune + EPCI rows). « Territoires d'industrie » is the sigle
 * provisional — the programme is officially named without an acronym (PRD
 * #162). The app's badge vocabulary (sigle → French nom) lives in the display
 * layer (fiche/apercu.ts), never here.
 */
export const SIGLES_PROGRAMMES = [
  'ACV',
  'PVD',
  'CRTE',
  "Territoires d'industrie",
  'ORT',
] as const

export type SigleProgramme = (typeof SIGLES_PROGRAMMES)[number]

/**
 * One membership row of the programmes payload (ADR-0013) — a territoire ×
 * programme at the programme's ANCHOR level: ACV/PVD commune rows, CRTE/TI
 * EPCI rows, ORT commune + EPCI rows. A labelled ACV/PVD commune carries the
 * « convention valant ORT » rider on ITS label row (never a second ORT row).
 * The ORT exception: freshness is the per-row « Dernière actualisation »
 * (vintage_date_reference never null) while the publication source is null by
 * contract (the stale page metadata is never cited — manifest #175).
 */
export interface MembreProgramme {
  territoire: string
  type: 'commune' | 'epci'
  sigle: SigleProgramme
  /** Le rider « convention valant ORT » — TRUE sur les seules lignes de label ACV/PVD. */
  convention_valant_ort: boolean
  vintage_source: string
  vintage_version: string
  /** Date ISO — l'actualisation PAR LIGNE pour les lignes ORT, jamais null. */
  vintage_date_reference: string
  /** Date ISO, ou null pour les lignes ORT (la publication source est NA par contrat). */
  vintage_date_publication: string | null
}

/**
 * One subvention aggregate row (ADR-0013, issue #176) — precomputed by the
 * pipeline, never derived in the app: commune rows carry the annual
 * by-policy-area split (programme_libl + montant), EPCI / département / région
 * rows the single annual total (programme_libl null). Every row wears the SCDL
 * weekly vintage stamp.
 */
export interface SubventionProgramme {
  territoire: string
  type: TerritoireType
  annee: number
  /** Le domaine (libellé) sur les lignes communales, null sur les lignes agrégat. */
  programme_libl: string | null
  montant: number
  vintage_source: string
  vintage_version: string
  vintage_date_reference: string
  vintage_date_publication: string
}

/**
 * The programmes payload file (programmes.json, issue #178) — a JSON OBJECT
 * with two arrays (membres + subventions, the two tables of ADR-0013), NOT an
 * array. Fetched with the « 404 = table absent » contract: a missing file
 * means the element is absent (payload.programmes null), never a fetch error.
 */
export interface ProgrammesPayload {
  membres: MembreProgramme[]
  subventions: SubventionProgramme[]
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
  /** The programmes payload (programmes.json) — optional; null = element absent (404). */
  programmes: ProgrammesPayload | null
}
