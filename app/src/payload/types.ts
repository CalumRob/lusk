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
 * - ranks are direction-aware ordinals ≥ 1 (1 = best, ADR-0015), each with its
 *   group-size column (« / Y »); null = no comparison group at that level
 * - value null = not computable for that territory
 * - keys of unbuilt themes are ABSENT from apercu (not null)
 * - two vintage dates per indicator: reference + publication
 * - territoires.epci is the SIREN for communes, null otherwise
 */

/**
 * The six themes, in canonical order (#408 — Programmes et subventions is the
 * sixth). The FICHE presents Programmes et subventions FIRST and selects it by
 * default (#408) — the presentation order is the fiche's own concern
 * (TerritoireView), never a second canonical list.
 */
export const THEMES_CANONIQUES = [
  'mobilite',
  'demographie',
  'habitat',
  'economie',
  'milieux',
  'programmes',
] as const

export type Theme = (typeof THEMES_CANONIQUES)[number]

export type TerritoireType = 'commune' | 'epci' | 'departement' | 'region'

/**
 * The sex dimension of an indicator's rows (issue #390): « F » (femmes) or
 * « M » (hommes). Only the sex-split indicators (e.g. structure_age, the real
 * pyramid) carry it; null/undefined = the row is not sex-split (the historical
 * scalar / total rows).
 */
export type Sexe = 'F' | 'M'

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
  /**
   * The reference date — null for a rolling base (DPE: ADR-0009, spec #12).
   * #408: publication can be null too (the ORT rows' continuous-follow
   * contract #175) — one of the two clocks is always present, never both null.
   */
  vintage_date_reference: string | null
  /** The publication date — null for a continuous-follow source (ORT, #175). */
  vintage_date_publication: string | null
}

/** One facts row per (territoire × key × detail × sex × dimension). */
export interface Indicateur extends VintageStamp {
  territoire: string
  type: TerritoireType
  theme: Theme
  key: string
  detail: string | null
  /** The sex dimension (issue #390) — carried by the sex-split indicators (structure_age). */
  sex?: Sexe | null
  /** Optional analytical dimension for multi-axis indicator facts. */
  dimension?: string | null
  value: number | null
  unit: string
  /** Contextual explanation for an unavailable value (pipeline-owned fact). */
  rider?: string | null
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
 * The Story row per territoire (schema name kept: histoires) — the RESOLVED
 * reading per (territoire, groupe) (issue #312, parent #308): the pipeline
 * selects the story and the salience; the payload carries ONE reading per
 * fiche subgroup, never the candidate pool. Discriminated by `theme`.
 */

/**
 * The identity columns every resolved reading carries (issue #312): the
 * territory, its fiche subgroup (`groupe` — the explicit join the app never
 * infers, US10), the SELECTED story key and the salience reason (`defaut` for
 * the always-on reading, the declared reason when a salience candidate fired).
 */
export interface LectureResolueBase {
  territoire: string
  type: TerritoireType
  theme: Theme
  /** The fiche subgroup this reading belongs to — the (territoire, groupe) identity. */
  groupe: string
  story_key: string
  /** Pourquoi cette lecture est choisie — « defaut » ou la raison de saillance déclarée. */
  salience_reason: RaisonSaillance
}

export interface HistoireDemographie extends LectureResolueBase {
  theme: 'demographie'
  story_key: 'trajectoire-demographique'
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

export interface HistoireHabitat extends LectureResolueBase {
  theme: 'habitat'
  story_key: 'etat-energetique-du-parc'
  /** Classification + parts de justification null sous le seuil n < 30 (suppression, R contract). */
  classification: string | null
  part_passoires: number | null
  part_abc: number | null
  n_dpe: number
}

/**
 * The Économie Story row (issue #120, RESOLVED by #312) — ONE row per
 * (territoire, groupe), the top-5 folded into flat params (top1_*..top5_*:
 * the reading content — the LQ for the specialisation reading; the rank is the
 * index, never a column).
 * A territory with fewer than five activities carries only its real ones (no
 * padding — the columns beyond stay null). Discriminated by `story_key` :
 * « ce que la commune abrite » (communes/EPCIs/départements, groupe
 * sante-et-taille). The activity label comes ALWAYS from the payload, never
 * hard-coded. Each row wears its vintage stamp (issue #74).
 */
export interface HistoireEconomie extends LectureResolueBase, VintageStamp {
  theme: 'economie'
  story_key: 'ce-que-la-commune-abrite'
  /** La matière de la lecture — le top-5 replié (le rang est l'index). */
  top1_activity_code: string | null
  top1_activity_label: string | null
  /** La spécialisation (LQ). */
  top1_lq: number | null
  top1_n: number | null
  /** La part du parc breton — null pour la lecture de spécialisation. */
  top1_part_parc: number | null
  top2_activity_code: string | null
  top2_activity_label: string | null
  top2_lq: number | null
  top2_n: number | null
  top2_part_parc: number | null
  top3_activity_code: string | null
  top3_activity_label: string | null
  top3_lq: number | null
  top3_n: number | null
  top3_part_parc: number | null
  top4_activity_code: string | null
  top4_activity_label: string | null
  top4_lq: number | null
  top4_n: number | null
  top4_part_parc: number | null
  top5_activity_code: string | null
  top5_activity_label: string | null
  top5_lq: number | null
  top5_n: number | null
  top5_part_parc: number | null
}

/**
 * The Mobilité Story row (issue #142, RESOLVED by #312) — ONE row per
 * territoire, the salience already resolved: the always-on default
 * « vingt-minutes-sans-voiture » everywhere, replaced ONLY where the bike
 * delta is real (classification « saillant », salience_reason
 * « delta-velo-saillant ») by « ce-que-le-velo-preserve ». The candidate pool
 * is never in the payload (ADR-0002). The row carries the reading (div_loss_t
 * — the service types that leave the reach à pied ou en transports en commun
 * at 20 minutes), the story depth (pct_iso_full_t), the precomputed
 * distribution signature (dens_1..10 + dec_1..10 + min/max — the
 * building-level density of div_loss_t, NEVER the matrix, lesson of issue
 * #131) and the saillance classification. When the vélo reading fires, the
 * signature columns carry the flattened distribution for the vélo story too
 * (the current contract keeps the signature available on vélo rows). Each row
 * carries the snapshot's vintage stamp (issue #74).
 */
export interface HistoireMobilite extends LectureResolueBase, VintageStamp {
  theme: 'mobilite'
  story_key: 'vingt-minutes-sans-voiture' | 'ce-que-le-velo-preserve'
  /** La lecture — les types de services perdus à pied ou en transports en commun à 20 min. */
  div_loss_t: number
  div_loss_b: number
  /** Ce que le vélo préserve déjà (div_loss_t − div_loss_b) — la matière de la saillance. */
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
export interface HistoireMilieux extends LectureResolueBase {
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

/** The closed BPE access-profile vocabulary emitted by the Mobilité pipeline. */
export const PROFILS_ACCES_BPE = [
  'voiture-requise',
  'acces-pied-tc',
  'velo-compense',
  'inaccessible-20-minutes',
] as const

export type ProfilAccesBpe = (typeof PROFILS_ACCES_BPE)[number]

export const LIBELLES_PROFILS_ACCES_BPE: Readonly<Record<ProfilAccesBpe, string>> = {
  'voiture-requise': 'La voiture est requise',
  'acces-pied-tc': 'Accès à pied ou en TC possible',
  'velo-compense': 'Le vélo compense',
  'inaccessible-20-minutes': 'Inaccessible ou presque en 20 minutes',
}

/** One bounded public row per (territoire × profile), with at most one exemplar. */
export interface ProfilAccesBpeRow {
  territoire: string
  type: TerritoireType
  profil: ProfilAccesBpe
  profil_libelle: string
  nombre_typequ: number
  exemplar_typequ: string
  exemplar_libelle: string
  exemplar_c: number
  exemplar_b: number
  exemplar_t: number
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
  /** Bounded Mobilité BPE projection; null/undefined means the element is absent. */
  profilsAccesBpe?: ProfilAccesBpeRow[] | null
  /**
   * The per-theme metadata files (theme_<theme>.json, issue #309, wired by
   * #313) — keyed by theme, present themes only. Optional at the type level:
   * payloads assembled from merged documents (parsePayload) or pre-seam
   * fixtures carry none; the loader and the store always produce the section.
   */
  themeMetadata?: Partial<Record<Theme, ThemeMetadata>>
}

/**
 * The per-theme metadata file (theme_<theme>.json, parent #308, issue #309) —
 * the payload-declared fiche grammar: subgroup order, labels/framing, figure
 * families, typed rich text, the resolved-histoire linkage and the
 * source-reference policy. The app renders labels, order and figures from
 * this file; it never keeps a second vocabulary. Since #408, Programmes et
 * subventions IS a theme — the sixth — and publishes its own
 * theme_programmes.json; its story registry is empty (a theme may hold
 * categorical and numeric indicators and no lecture).
 *
 * Mirrored in R (CLES_HISTOIRES_PAR_THEME + valider_theme_metadata,
 * pipeline/R/theme_metadata.R) — the same shape, the same rules, loud errors
 * on both sides.
 */

/** The eight figure families of the shared figure grammar (ADR-0023, #370). */
export const FAMILLES_FIGURE = [
  'scalar',
  'composition',
  'distribution',
  'trajectory',
  'relationship',
  'list',
  'pyramid',
  'comparison-bars',
] as const

export type FamilleFigure = (typeof FAMILLES_FIGURE)[number]

/**
 * La vocabulaire sémantique fermé des SIX familles de Repères (#437) :
 * scalar · composition · trajectory · distribution · relationship · list —
 * le miroir exact de FAMILLES_SEMANTIQUES (pipeline/R/theme_metadata.R), la
 * parité étant prouvée par test (theme-metadata-parity.spec.ts). C'est LA
 * liste sur laquelle les quatre tickets de grammaire Repères se branchent
 * (#438 trajectoires, #439 profils/listes, #440 distributions, #441
 * relations) ; les familles pyramid et comparison-bars partagent la mécanique
 * composition sans ajouter de sémantique (ADR-0023).
 */
export const FAMILLES_SEMANTIQUES = [
  'scalar',
  'composition',
  'trajectory',
  'distribution',
  'relationship',
  'list',
] as const

export type FamilleSemantique = (typeof FAMILLES_SEMANTIQUES)[number]

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
 * Programmes et subventions owns NONE (#408): a theme may legitimately hold
 * categorical and numeric indicators and no lecture — the registry is empty,
 * the theme's fiche subgroups declare no reading, none is invented.
 * Mirrored in R (CLES_HISTOIRES_PAR_THEME, pipeline/R/theme_metadata.R).
 */
export const CLES_HISTOIRES_PAR_THEME: Record<Theme, readonly string[]> = {
  mobilite: ['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'],
  demographie: ['trajectoire-demographique'],
  habitat: ['etat-energetique-du-parc'],
  economie: ['ce-que-la-commune-abrite'],
  milieux: ['se-densifier-setaler-ou-sen-aller'],
  programmes: [],
}

/**
 * The closed salience-reason vocabulary (issue #312): « defaut » for the
 * always-on reading, the declared reason when a salience candidate replaced
 * it (Mobilité: « delta-velo-saillant »). The validator refuses any other
 * value — never an invented reason. Mirrors SALIENCE_DEFAUT + the declared
 * reasons of STORIES_RESOLUES_PAR_THEME (pipeline/R/theme_metadata.R).
 */
export const RAISONS_SAILLANCE = ['defaut', 'delta-velo-saillant'] as const

export type RaisonSaillance = (typeof RAISONS_SAILLANCE)[number]

/**
 * The fiche subgroup per story (issue #312) — the TS mirror of
 * STORIES_RESOLUES_PAR_THEME (pipeline/R/theme_metadata.R): the groupe each
 * story resolves into, the explicit join the app never infers. Mobilité's
 * pool shares ONE groupe (the salience replaces the default inside the same
 * slot, ADR-0002); Économie's two readings live in two distinct groups.
 */
export const GROUPES_PAR_STORY: Record<Theme, Record<string, string>> = {
  mobilite: {
    'vingt-minutes-sans-voiture': 'acces-aux-services',
    'ce-que-le-velo-preserve': 'acces-aux-services',
  },
  demographie: { 'trajectoire-demographique': 'trajectoire-demographique' },
  habitat: { 'etat-energetique-du-parc': 'etat-energetique-du-parc' },
  economie: { 'ce-que-la-commune-abrite': 'sante-et-taille' },
  milieux: { 'se-densifier-setaler-ou-sen-aller': 'artificialisation' },
  programmes: {},
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
  figure?: FigureSousGroupe
}

/** One subgroup of the fiche — a stable place with indicators, a figure and an optional reading. */
export interface SousGroupeMetadata {
  key: string
  label: string
  framing: string
  indicators: string[]
  figure: FigureSousGroupe
  /** Absent for an honest indicator-only subgroup (e.g. structure-verte). */
  reading?: LectureSousGroupe
}

/**
 * The theme_<theme>.json contract. Validation rules (both sides):
 * - `theme` ∈ THEMES_CANONIQUES (the six, Programmes et subventions included
 *   since #408);
 * - `indicator_keys` / `story_keys` are the theme's registries; each subgroup
 *   indicator ∈ indicator_keys and each reading.story_key ∈ story_keys, and
 *   the bijection holds — every registry entry lives in EXACTLY one subgroup
 *   (nothing orphaned, nothing shared: the unique (territoire × groupe)
 *   identity of the parent #308). `story_keys` MAY BE EMPTY (#408): a theme
 *   may hold categorical and numeric indicators and no lecture — none is
 *   invented; any story that IS declared obeys the same rules as elsewhere;
 * - story keys must be owned by the theme (CLES_HISTOIRES_PAR_THEME — no
 *   cross-theme reference, ADR-0020);
 * - `sources` declares EXACTLY indicator_keys, each to a non-empty source id
 *   (the source-reference policy; the pipeline cross-checks ids against the
 *   vintages table at run time);
 * - the three label maps (issue #318 — the payload-owned vocabulary, the
 *   ONLY labels the fiche and the carte render, never a raw internal key):
 *   `indicator_labels` declares EXACTLY indicator_keys (a French label per
 *   registered indicator), `detail_labels` declares the detail labels of the
 *   multi-detail keys (each declared key ∈ indicator_keys, each label a
 *   non-empty string), `param_labels` declares EXACTLY the union of the
 *   subgroups' reading.params (the story-scalar labels the carte reads). The
 *   bidirectional parity against the published facts — every (key, detail)
 *   row of the payload has its label, no declared label is dead — is the
 *   guard verifierPariteLibelles (validate.ts), run at load.
 * - the fourth map (issue #362 — the reading-VALUE labels):
 *   `classification_labels` maps the classification VALUES of the reading
 *   templates (the pipeline's quadrants/lectures — attire-meurt,
 *   parc-intermediaire…) to their French prose, so a reading never renders a
 *   raw key. Optional for a theme whose templates never reference
 *   `classification` (Mobilité); REQUIRED (non-empty object of non-empty
 *   strings) once a reading.params references it. The one-directional
 *   parity — every published non-null classification value has its label —
 *   is verifierPariteLibelles.
 */
export interface ThemeMetadata {
  theme: Theme
  label: string
  subgroups: SousGroupeMetadata[]
  indicator_keys: string[]
  story_keys: string[]
  sources: Record<string, string>
  /**
   * The indicator labels — EXACTLY indicator_keys, key → French label
   * (the fiche's figures and the carte's indicator layers read it).
   */
  indicator_labels: Record<string, string>
  /**
   * The detail labels of the multi-detail keys — key → (detail → French
   * label). Keys are a subset of indicator_keys; the parity guard proves
   * every published detail value has its label.
   */
  detail_labels: Record<string, Record<string, string>>
  /**
   * The reading-param labels — EXACTLY the union of subgroups[].reading.params
   * (first-declaration order), param → French label. The carte reads it for
   * the story-scalar layers; a raw histoire field name is never a label.
   */
  param_labels: Record<string, string>
  /**
   * The classification-VALUE labels (issue #362 — the 4th map, the reading
   * values): classification key → French prose (attire-meurt → « attire, mais
   * se meurt »). The reading templates resolve the `classification` param
   * through it — a value absent from the map makes the reading unavailable,
   * never a raw key. Optional for themes that never reference `classification`
   * (Mobilité); REQUIRED once a reading.params references it (non-empty
   * object of non-empty strings). The published-value parity is the
   * verifierPariteLibelles load guard.
   */
  classification_labels?: Record<string, string>
  /** Optional page descriptor: only published entries are eligible for /indicateurs. */
  /** Per-concept publication descriptors; the indicator key is the authority. */
  indicator_pages?: Record<string, IndicatorPageMetadata>
  /** Reusable provenance records, referenced by indicator_pages.sources. */
  source_records?: Record<string, SourceRecord>
  /** Caveats for published facts whose scalar page descriptor is not shipped yet. */
  indicator_caveats?: Record<string, string>
  /** Optional map-layer eligibility, keyed by indicator; omitted entries stay eligible. */
  map_layers?: Record<string, boolean>
}

export interface SourceRecord {
  /** Stable source-record key; when nested this is the dataset anchor. */
  id?: string
  dataset: string
  publisher: string
  url: string
  licence: string
  vintage: string
  freshness: string
  /** Full freshness rows; the scalar fields remain a compatibility summary. */
  vintages?: SourceVintageRecord[]
  /** Named clocks are structured facts, never prose concatenated by a view. */
  clocks?: SourceClock[]
  caveat?: string
}

export interface SourceVintageRecord {
  id: string
  label: string
  version: string | null
  licence: string | null
  dateReference: string | null
  datePublication: string | null
}

export interface SourceClock {
  name: string
  frequency: string
  reference: string
  trigger?: string
}

/** Shared page contract. The discriminated union is keyed on `family`; the
 * validators NORMALIZE the legacy family-less #401 payload to `family:
 * 'scalar'`, so the type below always carries it (#437 — no do-nothing
 * optional alias). */
export interface IndicatorPageMetadataBase {
  indicator: string
  detail?: string | null
  label: string
  definition: string
  unit: string
  calculation: string
  direction: 'high' | 'low'
  caveats: string
  levels: TerritoireType[]
  sources: string[]
  /** Payload-declared comparison facet dimensions. */
  comparison?: ComparisonFacetMetadata
}

export interface ComparisonFacetMetadata {
  indicator?: string
  /** Le libellé public unique de la facette — requis quand elle lit une autre clé que la page (#440). */
  label?: string
  detail?: string | null
  /** Allowed URL values; absent means this dimension is not declared. */
  details?: string[]
  sex?: Sexe | null
  sexes?: Sexe[]
  dimension?: string | null
  dimensions?: string[]
  direction?: 'high' | 'low'
  unit?: string
  labels?: Record<string, string>
}
/** A declared x-axis tick for a metadata-driven trajectory. */
export interface TrajectoryTickMetadata {
  /** Published detail represented by this tick. */
  detail: string
  /** Human label; raw detail keys never render. */
  label: string
  /** Keep this anchor when the chart has to hide dense labels on mobile. */
  mobile?: boolean
}

/** Optional second series, axis grammar and marker for a metadata-driven trajectory. */
export interface TrajectoryReferenceMetadata {
  /** Published indicator key carrying the comparison series. */
  indicator: string
  /** Territory row carrying the reference series. */
  territoire: string
  /** Public label shown in the legend and text alternative. */
  label: string
}

export interface TrajectoryMarkerMetadata {
  /** Detail on the x axis at which the marker is drawn. */
  detail: string
  /** Public label shown with the marker and in the text alternative. */
  label: string
}

export interface TrajectoryMetadata {
  endpoints: string[]
  /** `numeric` positions points from their detail; omitted means ordinal. */
  axis?: 'ordinal' | 'numeric'
  /** Optional explicit axis labels, owned by the metadata contract. */
  axisLabels?: { x: string; y: string }
  /** Optional explicit ticks; omitted trajectories derive labels from details. */
  ticks?: TrajectoryTickMetadata[]
  reference?: TrajectoryReferenceMetadata
  marker?: TrajectoryMarkerMetadata
}
export interface CompositionMetadata { parts: string[] }
/**
 * Une distribution ne se compare JAMAIS par ses bins (#440) : la facette
 * inter-territoires est la `comparison` déclarée de la page — une clé publiée,
 * souvent une AUTRE que la page (part_passoires résume distribution_dpe) — et
 * pilote carte, extrêmes et tableau avec son unité déclarée. La signature
 * déclare les détails fermés de la distribution intra-territoire, rendue
 * all-or-nothing pour le territoire sélectionné.
 */
export interface DistributionMetadata { signature: string[] }
/**
 * Une relation n'est JAMAIS un score unique (#441) : la facette scalaire est
 * la `comparison` déclarée de la page — une clé publiée, son libellé public —
 * et pilote seule carte, extrêmes et tableau ; le nuage croise deux rôles
 * déclarés (x × y), chacun une clé publiée du thème portant son libellé et
 * son unité propres (ADR-0023 : payload-owned, jamais une clé brute au rendu).
 */
export interface RelationshipRoleMetadata { indicator: string; detail: string | null; label: string; unit: string }
export interface RelationshipMetadata { roles: { x: RelationshipRoleMetadata; y: RelationshipRoleMetadata } }
export interface ListMetadata { categories: string[] }
export interface PyramidMetadata { dimensions: string[] }
export interface ComparisonBarsMetadata { series: string[] }

export type ScalarPageMetadata = IndicatorPageMetadataBase & { family: 'scalar' }
export type TrajectoryPageMetadata = IndicatorPageMetadataBase & { family: 'trajectory'; trajectory: TrajectoryMetadata }
export type CompositionPageMetadata = IndicatorPageMetadataBase & { family: 'composition'; composition: CompositionMetadata }
export type DistributionPageMetadata = IndicatorPageMetadataBase & { family: 'distribution'; distribution: DistributionMetadata }
export type ListPageMetadata = IndicatorPageMetadataBase & { family: 'list'; list: ListMetadata }
export type RelationshipPageMetadata = IndicatorPageMetadataBase & { family: 'relationship'; relationship: RelationshipMetadata }
export type PyramidPageMetadata = IndicatorPageMetadataBase & { family: 'pyramid'; pyramid: PyramidMetadata }
/** JSON uses the ADR family literal as the key; TS uses camelCase. */
export type ComparisonBarsPageMetadata = IndicatorPageMetadataBase & { family: 'comparison-bars'; comparisonBars: ComparisonBarsMetadata }
export type IndicatorPageMetadata = ScalarPageMetadata | TrajectoryPageMetadata | CompositionPageMetadata | DistributionPageMetadata | ListPageMetadata | RelationshipPageMetadata | PyramidPageMetadata | ComparisonBarsPageMetadata
