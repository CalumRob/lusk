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

/** The rank-in-context columns of the indicateurs table (ADR-0015, ADR-0021). */
export type ColonneRang = 'rang_epci' | 'rang_dep' | 'rang_reg'

/** The group-size columns — the « / Y » of the ordinal chip, one per rank column. */
export type ColonneTailleRang = 'rang_epci_n' | 'rang_dep_n' | 'rang_reg_n'

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
  /**
   * The direction-aware ordinal position (ADR-0015): 1 = best, an integer ≥ 1,
   * ties share the rank and the next rank skips (1, 1, 3). null = no
   * comparison group at that level. Each rank carries its group size in the
   * matching `rang_*_n` column — the « / Y » of the chip, always shown.
   */
  rang_epci: number | null
  rang_dep: number | null
  rang_reg: number | null
  /** The group size of each rank column — the non-NA members of the group. */
  rang_epci_n: number | null
  rang_dep_n: number | null
  rang_reg_n: number | null
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
 * The Milieux Story row (issue #174, ADR-0014, re-keyed by spec #225) —
 * « Se densifier, s'étaler, ou s'en aller », the single Story of the fifth
 * theme: ONE row per territory, the reading by the SIGNS alone (threshold 0).
 * The pivot (spec #225) replaces the CONSOENAF flow columns with the OCS-GE
 * STATES (the stock of artificialized land at each millésime, IGN
 * OCS-GE Artificialisation NG v2.0) — renaturation becomes measurable
 * (artif_m3 < artif_m2) and the per-capita figure exists for every territory
 * (no NA hole). The two forces: Δpopulation (from the Démographie série
 * historique — the population-sourcing rule of ADR-0014) and the per-capita
 * state trajectory `trajectoire_artif_par_habitant` (M3/M2 per-capita ratio).
 * The two windows are named separately (the two-clocks discipline):
 * `periode_pop` (the shared population window, the RP bracketing rule —
 * 2017 initial, 2023 final) and `periode_artif` (the per-département OCS-GE
 * state window; a span with per-dépt dates for cross-département EPCIs and
 * the région). Invariant locked by the contract:
 * sign(ratio − 1) = sign(delta) with delta = artif_m3_par_habitant −
 * artif_m2_par_habitant — the classification and the graph can never
 * disagree. The states and the trajectory are nullable in two honest cases
 * (the pipeline's discovery #243): M2 = 0 (102 real communes, ~8 % — the
 * ratio M3/0 is UNDEFINED, the trajectory and the classification are null,
 * never an invented infinite ratio) and the absent-state hole (a territory
 * whose data is missing — all states null, classification null). When the
 * states are present and M2 per-capita > 0, everything is a number and the
 * invariant holds. Classification null = incomplete window (never an
 * invented reading).
 */
export interface HistoireMilieux {
  territoire: string
  type: TerritoireType
  theme: 'milieux'
  story_key: 'se-densifier-setaler-ou-sen-aller'
  /** La fenêtre partagée de la population (le bracket RP — "2017-2023"). */
  periode_pop: string
  /**
   * La fenêtre des états OCS-GE (le span par département pour les agrégats
   * multi-dépt). Null quand le territoire n'a AUCUNE donnée OCS-GE (le trou
   * NA honnête — pas de fenêtre sans états) ; la fenêtre de population, elle,
   * existe toujours.
   */
  periode_artif: string | null
  delta_population: number
  /**
   * Le taux annuel de variation de la population (‰/an) — la force population
   * du quadrant, annualisée et normalisée par la population moyenne du bracket
   * INSEE ((pop_debut + pop_fin) / 2, la même convention que Démographie,
   * ADR-0011). Null quand la population moyenne est nulle (le 0 réel des
   * villages détruits — jamais une division par zéro, jamais un taux inventé).
   * Le delta brut reste publié à côté (le prose le cite) ; la classification
   * lit le signe seul du delta — identique pour le compte et pour le taux.
   */
  taux_variation_population: number | null
  /** La surface artificialisée à l'état initial (M2), en ha — null si la donnée manque. */
  artif_m2: number | null
  /** La surface artificialisée à l'état final (M3), en ha — null si la donnée manque. */
  artif_m3: number | null
  /** La surface artificialisée par habitant à M2, en m²/hab — null si la donnée manque. */
  artif_m2_par_habitant: number | null
  /** La surface artificialisée par habitant à M3, en m²/hab — null si la donnée manque. */
  artif_m3_par_habitant: number | null
  /**
   * Le ratio M3/M2 par habitant — la trajectoire, la seconde force de la
   * lecture. Null quand M2 par habitant est nul (le ratio est indéfini —
   * découverte #243) ou quand les états manquent ; non négatif sinon (0 = la
   * renaturation complète, M3 nul).
   */
  trajectoire_artif_par_habitant: number | null
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
 * One subvention aggregate row (ADR-0013, issue #176, contrat révisé #305) —
 * precomputed by the pipeline: commune rows carry the annual FULL per-policy-
 * area split (programme_libl + montant — every domaine, never a « autres »
 * line), EPCI / département / région rows the single annual total
 * (programme_libl null). The app derives the display from these rows (the
 * descending sort, the top-5 fold, the part de contexte and the provenance —
 * the seam « the app renders »). Every row wears the SCDL weekly vintage
 * stamp.
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
  /**
   * The Aperçu basic-stats table (apercu.json) — optional; null = the file
   * is absent (404 — issue #122: since #116 the pipeline only publishes it
   * when a theme HAS an aperçu, so absence means « not built », never an
   * error).
   */
  apercu: ApercuRow[] | null
  runReport: RunReport | null
  /** The shared vintage table (vintages.json) — optional, like run-report. */
  vintages: Vintage[] | null
  /** The programmes payload (programmes.json) — optional; null = element absent (404). */
  programmes: ProgrammesPayload | null
}

/**
 * The per-theme metadata file (theme_<theme>.json, parent #308, issue #309) —
 * the payload-declared fiche grammar: subgroup order, labels/framing, figure
 * families, typed rich text, the resolved-histoire linkage and the
 * source-reference policy. The app renders labels, order and figures from
 * this file; it never keeps a second vocabulary. Programmes & financements is
 * NOT a theme — it is a separate publication contract (programmes.json,
 * ADR-0013) and never receives a fabricated theme_<theme>.json file.
 *
 * Mirrored in R (CLES_HISTOIRES_PAR_THEME + valider_theme_metadata,
 * pipeline/R/theme_metadata.R) — the same shape, the same rules, loud errors
 * on both sides.
 */

/** The six figure families of the shared figure grammar (parent #308). */
export const FAMILLES_FIGURE = [
  'scalar',
  'composition',
  'distribution',
  'trajectory',
  'relationship',
  'profile',
] as const

export type FamilleFigure = (typeof FAMILLES_FIGURE)[number]

/** The constrained rich-text node types — raw HTML is forbidden (parent #308). */
export const TYPES_NOEUD_TEXTE_RICHE = [
  'text',
  'param',
  'territoire',
  'strong',
  'link',
] as const

export type TypeNoeudTexteRiche = (typeof TYPES_NOEUD_TEXTE_RICHE)[number]

/**
 * The canonical story keys per theme — the hermeticity registry (ADR-0020):
 * a theme's metadata may only link ITS OWN stories, never another theme's —
 * a story key owned by another theme is a cross-theme reference, rejected.
 * Mirrored in R (CLES_HISTOIRES_PAR_THEME, pipeline/R/theme_metadata.R).
 */
export const CLES_HISTOIRES_PAR_THEME: Record<Theme, readonly string[]> = {
  mobilite: ['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'],
  demographie: ['trajectoire-demographique'],
  habitat: ['etat-energetique-du-parc'],
  economie: ['ce-que-la-commune-abrite', 'ce-que-la-bretagne-abrite'],
  milieux: ['se-densifier-setaler-ou-sen-aller'],
}

/** A text node — raw HTML in the content is forbidden (chevrons rejected). */
export interface NoeudTexte {
  type: 'text'
  content: string
}

/** A reading value — must be declared in the subgroup's reading.params. */
export interface NoeudParam {
  type: 'param'
  key: string
}

/** Renders the territory's name — no payload to carry. */
export interface NoeudTerritoire {
  type: 'territoire'
}

/** A container node — non-empty children; a link never nests inside it. */
export interface NoeudGras {
  type: 'strong'
  children: NoeudTexteRiche[]
}

/** An explicit link node — raw HTML anchors are forbidden; no nested links. */
export interface NoeudLien {
  type: 'link'
  href: string
  children: NoeudTexteRiche[]
}

/** The constrained typed rich-text AST of a reading template. */
export type NoeudTexteRiche = NoeudTexte | NoeudParam | NoeudTerritoire | NoeudGras | NoeudLien

/** The subgroup's compact figure — a family + the indicator it renders. */
export interface FigureSousGroupe {
  family: FamilleFigure
  /** An indicator the subgroup owns — the figure renders the subgroup's matter. */
  indicator: string
}

/**
 * The resolved-histoire reading of a subgroup (parent #308): the explicit
 * story_key link (the app never infers it from names), the reading values
 * the template may reference (params) and the typed rich-text template.
 */
export interface LectureSousGroupe {
  story_key: string
  params: string[]
  template: NoeudTexteRiche[]
}

/** One subgroup of the fiche — a stable place with indicators, a figure and a reading. */
export interface SousGroupeMetadata {
  key: string
  label: string
  framing: string
  indicators: string[]
  figure: FigureSousGroupe
  reading: LectureSousGroupe
}

/**
 * The theme_<theme>.json contract. Validation rules (both sides):
 * - `theme` ∈ THEMES_CANONIQUES, never « programmes » (separate contract);
 * - `indicator_keys` / `story_keys` are the theme's registries; each subgroup
 *   indicator ∈ indicator_keys and each reading.story_key ∈ story_keys, and
 *   the bijection holds — every registry entry lives in EXACTLY one subgroup
 *   (nothing orphaned, nothing shared: the unique (territoire × groupe)
 *   identity of the parent #308);
 * - story keys must be owned by the theme (CLES_HISTOIRES_PAR_THEME — no
 *   cross-theme reference, ADR-0020);
 * - `sources` declares EXACTLY indicator_keys, each to a non-empty source id
 *   (the source-reference policy; the pipeline cross-checks ids against the
 *   vintages table at run time).
 */
export interface ThemeMetadata {
  theme: Theme
  label: string
  subgroups: SousGroupeMetadata[]
  indicator_keys: string[]
  story_keys: string[]
  sources: Record<string, string>
}
