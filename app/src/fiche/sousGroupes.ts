/**
 * The shared fiche subgroup mapper (issue #314, parent #308) — the app's half
 * of the manifest-driven fiche: ONE loop over the theme's metadata subgroups
 * for every theme, never a per-theme branch. Everything the subgroup renders
 * comes from the payload contract:
 *
 * - the subgroup ORDER, label, framing and indicator keys from
 *   theme_<theme>.json (themeMetadata) — the app owns no label/order
 *   dictionary for the subgroups;
 * - the compact figure (famille + indicateur) from the metadata, its rows
 *   from the payload;
 * - the RESOLVED reading from the histoires row joined by
 *   (territoire, groupe) — the explicit subgroup link of the contract
 *   (#312), never inferred from names or story keys (US 10–11);
 * - the reading COPY from the metadata reading template, its params resolved
 *   from the row. A reading whose row is absent, or whose referenced params
 *   are null, FAILS HONESTLY (lecture null, lectureIndisponible) — never an
 *   invented sentence.
 *
 * The figure/chart selection of a reading is driven by the metadata story_key
 * (figureLecturePour), never by the theme prop; a story key without a known
 * figure renders text-only (honest, never a fabricated chart).
 */

import type {
  FamilleFigure,
  Histoire,
  HistoireDemographie,
  HistoireMobilite,
  HistoireMilieux,
  Indicateur,
  NoeudTexteRiche,
  Payload,
  Theme,
  ThemeMetadata,
} from '@/payload/types'
import {
  formaterNombreFR,
  formaterVintage,
  nuageComparaison,
  nuageMilieux,
  nuageMobilite,
  trouverTerritoire,
} from '@/payload/selectors'
import type {
  GroupeIndicateur,
  PointNuage,
  PointNuageMilieux,
  PointNuageMobilite,
} from '@/payload/selectors'

/** The subgroup's compact figure — family + indicator from the metadata, rows from the payload. */
export interface FigureCompacte {
  famille: FamilleFigure
  /** The indicator the figure renders — the subgroup's matter. */
  clef: string
  lignes: Indicateur[]
}

/** The resolved reading of a subgroup — the row plus the template params displayed. */
export interface LectureSousGroupe {
  /** The story key the metadata subgroup links to — the chart registry key. */
  story_key: string
  /** The resolved row (the (territoire, groupe) join of the contract). */
  histoire: Histoire
  /** The metadata reading template — the payload-owned copy the slot renders. */
  template: NoeudTexteRiche[]
  /**
   * The template params the template actually REFERENCES, resolved to display
   * strings (formatted numbers, string keys verbatim). Only referenced params
   * must resolve — a declared-but-unreferenced param (the vélo row's
   * pct_iso_full_t, by contract) never kills the reading.
   */
  parametres: Record<string, string>
  /** Optional payload-declared reading family (e.g. the LQ list). */
  figure?: { family: FamilleFigure; indicator: string }
}

/** One fiche subgroup, rendered — the shared anatomy of all five themes. */
export interface SousGroupeRendu {
  key: string
  label: string
  framing: string
  /** The subgroup's indicator figures — metadata order, never an app-side order. */
  figures: GroupeIndicateur[]
  /** The subgroup's compact figure (famille + indicateur de la métadonnée). */
  figureCompacte: FigureCompacte | null
  /** The resolved reading of the subgroup — null when absent or unreadable. */
  lecture: LectureSousGroupe | null
  /**
   * The honest-absence flag: the (territoire, groupe) row EXISTS but its
   * referenced params are null (the pipeline's declared no-reading states:
   * Milieux M2 = 0, Habitat under the suppression threshold). The fiche says
   * so instead of inventing a reading — and stays SILENT when there is no row
   * at all (absent data ≠ declared absence).
   */
  lectureIndisponible: boolean
}

/**
 * The precomputed building-level distribution of div_loss_t (ADR-0012) — the
 * Mobilité reading's chart matter (kept here since the app-side story mapper
 * that owned it is gone with #314).
 */
export interface DistributionMobilite {
  /** Les 10 densités de la signature (une par bin de décile). */
  dens: (number | null)[]
  /** Les 10 bornes de déciles de la distribution. */
  dec: (number | null)[]
  min: number | null
  max: number | null
}

/** The chart of a resolved reading — one per metadata story_key that owns one. */
export type FigureLecture =
  | {
      genre: 'soldes'
      tauxNaturel: number
      tauxMigratoire: number
      classification: string
      nom: string
      nuage: PointNuage[]
    }
  | {
      genre: 'distribution'
      distribution: DistributionMobilite
      mediane: number
      medianeVelo: number
      /** Mode labels resolved from the payload classification vocabulary. */
      modes: { t: string; b: string }
      nom: string
      nuage: PointNuageMobilite[]
    }
  | {
      genre: 'quadrant'
      tauxVariationPopulation: number
      deltaM2ParHabitant: number
      classification: string
      nom: string
      periodePop: string
      periodeArtif: string
      nuage: PointNuageMilieux[]
    }

/**
 * The histoires % keys — published as fractions in [0,1] (the same contract as
 * the indicateurs with unit « % ») but read as percentages by the templates.
 * Keyed by FIELD NAME, never by theme: the formatting rule travels with the
 * payload key wherever it appears.
 */
const CLEFS_POURCENT: ReadonlySet<string> = new Set([
  'part_passoires',
  'part_abc',
  'part_parc',
  'pct_iso_full_t',
])

/** The top-N aliases of the folded Économie reading (the rank is the index, never a column). */
const CLEFS_TOP_N: readonly string[] = ['activity_label', 'lq', 'n', 'part_parc', 'activity_code']

/** The vintages-table ids each reading cites exhaustively — never invented. */
const SOURCES_PAR_STORY: Record<string, readonly string[]> = {
  'trajectoire-demographique': ['serie_historique', 'epci'],
  'se-densifier-setaler-ou-sen-aller': [
    'serie_historique',
    'ocsge_artificialisation_22_2021',
    'ocsge_artificialisation_22_2025',
    'ocsge_artificialisation_29_2021',
    'ocsge_artificialisation_29_2024',
    'ocsge_artificialisation_35_2020',
    'ocsge_artificialisation_35_2023',
    'ocsge_artificialisation_56_2022',
    'ocsge_artificialisation_56_2024',
  ],
}

/** The params the template ACTUALLY references — declared-but-unreferenced params never kill the reading. */
function clesParametresReferencees(template: NoeudTexteRiche[]): string[] {
  const cles: string[] = []
  function parcourir(noeuds: NoeudTexteRiche[]): void {
    for (const noeud of noeuds) {
      if (noeud.type === 'param') cles.push(noeud.key)
      else if (noeud.type === 'strong' || noeud.type === 'link') parcourir(noeud.children)
    }
  }
  parcourir(template)
  return cles
}

/** One display value of the template — null means the reading cannot be composed. */
function formaterValeurParametre(
  valeur: unknown,
  clef: string,
  metadata?: ThemeMetadata,
): string | null {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur !== 'number') {
    // La classification se résout à travers la carte payload-owned (#362) —
    // JAMAIS la clé brute : une valeur absente de la carte (impossible sous
    // le validateur, qui l'exige dès qu'un template référence classification)
    // rend la lecture indisponible, pas une clé brute dans le texte. Les
    // autres chaînes (periode, periode_pop…) passent telles quelles.
    if (clef === 'classification') {
      const libelle = metadata?.classification_labels?.[String(valeur)]
      if (libelle === undefined) return null
      return libelle
    }
    return String(valeur)
  }
  // les fractions % se lisent en pourcentage (0,1333 → « 13,3 ») ; les autres
  // nombres (taux ‰, ratios, comptes) restent tels quels
  if (CLEFS_POURCENT.has(clef)) return formaterNombreFR(valeur * 100, 1)
  return formaterNombreFR(valeur, 2)
}

/**
 * Resolve ONE template param from the row: the row's own field first, then the
 * folded top-N aliases of the Économie reading (activity_label, lq, n,
 * part_parc — resolved on the FIRST present rank; « rang » is the index).
 * The theme metadata rides down so a referenced `classification` resolves
 * through its classification_labels map (issue #362) — never a raw key.
 */
function valeurParametre(
  histoire: Histoire,
  clef: string,
  metadata?: ThemeMetadata,
): string | null {
  const brut = (histoire as unknown as Record<string, unknown>)[clef]
  if (brut !== undefined) return formaterValeurParametre(brut, clef, metadata)

  if (clef === 'rang' || CLEFS_TOP_N.includes(clef)) {
    const ligne = histoire as unknown as Record<string, unknown>
    for (let k = 1; k <= 5; k++) {
      const code = ligne[`top${k}_activity_code`]
      if (code === null || code === undefined) continue
      if (clef === 'rang') return String(k)
      return formaterValeurParametre(ligne[`top${k}_${clef}`], clef, metadata)
    }
  }
  return null
}

/** The resolved reading of one (territoire, groupe) — or null when absent. */
function lecturePour(
  payload: Payload,
  theme: Theme,
  territoire: string,
  groupe: string,
  template: NoeudTexteRiche[],
  metadata: ThemeMetadata,
  figure?: LectureSousGroupe['figure'],
): { lecture: LectureSousGroupe | null; indisponible: boolean } {
  const histoire = payload.histoires.find(
    (h) => h.theme === theme && h.territoire === territoire && h.groupe === groupe,
  )
  if (!histoire) return { lecture: null, indisponible: false }

  const parametres: Record<string, string> = {}
  for (const clef of clesParametresReferencees(template)) {
    const valeur = valeurParametre(histoire, clef, metadata)
    if (valeur === null) return { lecture: null, indisponible: true }
    parametres[clef] = valeur
  }
  // La story RÉSOLUE de la ligne (la sélection du pipeline, #312) — le
  // sous-groupe déclare le lien canonique dans la métadonnée, la ligne porte
  // la sélection effective (la saillance vélo remplace le défaut, même groupe).
  return {
    lecture: { story_key: histoire.story_key, histoire, template, parametres, ...(figure ? { figure } : {}) },
    indisponible: false,
  }
}

/**
 * The shared subgroup loop of the fiche — the metadata order, labels, framing,
 * indicator keys, figure family and reading linkage, for ANY theme. An absent
 * metadata (impossible under the loader contract — a present theme REQUIRES
 * its theme_<theme>.json, #313) reads as no subgroups, never a fabricated
 * block.
 */
export function sousGroupesPourTerritoire(
  payload: Payload,
  theme: Theme,
  territoire: string,
): SousGroupeRendu[] {
  const metadata = payload.themeMetadata?.[theme]
  if (!metadata) return []

  const groupesParCle = new Map<string, Indicateur[]>()
  for (const ligne of payload.indicateurs) {
    if (ligne.theme !== theme || ligne.territoire !== territoire) continue
    const groupe = groupesParCle.get(ligne.key)
    if (groupe) groupe.push(ligne)
    else groupesParCle.set(ligne.key, [ligne])
  }

  return metadata.subgroups.map((sousGroupe) => {
    const figures: GroupeIndicateur[] = []
    for (const clef of sousGroupe.indicators) {
      const lignes = groupesParCle.get(clef)
      if (lignes && lignes.length > 0) figures.push({ key: clef, lignes })
    }

    const lignesFigure = groupesParCle.get(sousGroupe.figure.indicator)
    const figureCompacte: FigureCompacte | null =
      lignesFigure && lignesFigure.length > 0
        ? { famille: sousGroupe.figure.family, clef: sousGroupe.figure.indicator, lignes: lignesFigure }
        : null

    const { lecture, indisponible } = lecturePour(
      payload,
      theme,
      territoire,
      sousGroupe.key,
      sousGroupe.reading.template,
      metadata,
      sousGroupe.reading.figure,
    )

    return {
      key: sousGroupe.key,
      label: sousGroupe.label,
      framing: sousGroupe.framing,
      figures,
      figureCompacte,
      lecture,
      lectureIndisponible: indisponible,
    }
  })
}

/** The Mobilité distribution signature, from the row's flat bins. */
function distributionDe(histoire: HistoireMobilite): DistributionMobilite {
  if (histoire.distribution_signature) return histoire.distribution_signature
  return {
    dens: [
      histoire.dens_1, histoire.dens_2, histoire.dens_3, histoire.dens_4, histoire.dens_5,
      histoire.dens_6, histoire.dens_7, histoire.dens_8, histoire.dens_9, histoire.dens_10,
    ],
    dec: [
      histoire.dec_1, histoire.dec_2, histoire.dec_3, histoire.dec_4, histoire.dec_5,
      histoire.dec_6, histoire.dec_7, histoire.dec_8, histoire.dec_9, histoire.dec_10,
    ],
    min: histoire.dens_min,
    max: histoire.dens_max,
  }
}

/**
 * The reading's compact figure — selected by the METADATA story_key (the
 * manifest's histoire linkage), never by the theme prop. A story key without
 * a known figure (the vélo salience, the Économie list readings, Habitat —
 * prose-only) renders text-only: null, honest.
 */
export function figureLecturePour(
  payload: Payload,
  territoire: string,
  lecture: LectureSousGroupe,
): FigureLecture | null {
  const histoire = lecture.histoire
  const nom = trouverTerritoire(payload, territoire)?.nom ?? territoire
  const metadata = payload.themeMetadata?.[histoire.theme]
  const classificationLabel = (value: string) => metadata?.classification_labels?.[value] ?? null

  if (lecture.story_key === 'trajectoire-demographique') {
    const h = histoire as HistoireDemographie
    const classification = classificationLabel(h.classification)
    if (classification === null) return null
    return {
      genre: 'soldes',
      tauxNaturel: h.taux_solde_naturel,
      tauxMigratoire: h.taux_solde_migratoire,
      classification,
      nom,
      nuage: nuageComparaison(payload, territoire) ?? [],
    }
  }

  if (lecture.story_key === 'vingt-minutes-sans-voiture' || lecture.story_key === 'ce-que-le-velo-preserve') {
    const h = histoire as HistoireMobilite
    // Mode wording is resolved from the payload's shared reseaux vocabulary;
    // classification_labels describes reading values, not transport modes.
    const modes = modesDepuisMetadata(metadata)
    return {
      genre: 'distribution',
      distribution: distributionPourLecture(h),
      mediane: h.div_loss_t,
      medianeVelo: h.div_loss_b,
      modes,
      nom,
      nuage: nuageMobilite(payload, territoire) ?? [],
    }
  }

  if (lecture.story_key === 'se-densifier-setaler-ou-sen-aller') {
    const h = histoire as HistoireMilieux
    // une lecture porte toujours sa seconde force (le contrat #243) : les
    // états définis, la trajectoire, le taux et la fenêtre — sinon pas de
    // point à tracer, jamais un point fabriqué
    if (h.classification === null) return null
    if (h.trajectoire_artif_par_habitant === null) return null
    if (h.artif_m2_par_habitant === null || h.artif_m3_par_habitant === null) return null
    if (h.taux_variation_population === null) return null
    if (h.periode_artif === null) return null
    const classification = classificationLabel(h.classification)
    if (classification === null) return null
    return {
      genre: 'quadrant',
      tauxVariationPopulation: h.taux_variation_population,
      deltaM2ParHabitant: h.artif_m3_par_habitant - h.artif_m2_par_habitant,
      classification,
      nom,
      periodePop: h.periode_pop,
      periodeArtif: h.periode_artif,
      nuage: nuageMilieux(payload, territoire) ?? [],
    }
  }

  return null
}

function distributionPourLecture(histoire: HistoireMobilite): DistributionMobilite {
  return distributionDe(histoire)
}

/** Mode labels come from the payload's established `reseaux` vocabulary. */
function modesDepuisMetadata(metadata: ThemeMetadata | undefined): { t: string; b: string } {
  const details = metadata?.detail_labels.reseaux
  const mode = (libelle: string | undefined) => libelle?.replace(/^[^—]+—\s*/, '') ?? ''
  return { t: mode(details?.t_densite), b: mode(details?.b_densite) }
}

/** The five payload-owned LQ rows become a compact reading figure. */
export interface LigneLQ {
  rang: number
  activite: string
  lq: number | null
}

export function lignesLQPour(lecture: LectureSousGroupe): LigneLQ[] {
  // Only the commune/EPCI/département specialisation story owns LQ. The
  // regional presence story has different matter (part of the parc), and
  // must not acquire an invented list merely because its theme is économie.
  if (lecture.figure?.family !== 'list' || lecture.figure.indicator !== 'lq') return []
  const h = lecture.histoire
  const lignes: LigneLQ[] = []
  for (let rang = 1; rang <= 5; rang += 1) {
    const activite = h[`top${rang}_activity_label` as keyof typeof h] as string | null
    if (!activite) continue
    lignes.push({ rang, activite, lq: h[`top${rang}_lq` as keyof typeof h] as unknown as number | null })
  }
  return lignes
}

/**
 * The reading's source line — exhaustive, never invented: the readings of the
 * light themes cite their vintages-table ids (the shared table, ADR-0005); a
 * reading that wears its own stamp (Mobilité, Économie — issue #74) cites it.
 * Absent table → no line (honest, nothing to cite).
 */
export function sourceLecture(payload: Payload, lecture: LectureSousGroupe): string | null {
  const vintages = payload.vintages
  if (!vintages) return null

  const ids = SOURCES_PAR_STORY[lecture.story_key]
  if (ids) {
    const citees = vintages.filter((v) => ids.includes(v.id))
    if (citees.length === 0) return null
    return citees.map((v) => `${v.source} · ${v.version}`).join(' · ')
  }

  const histoire = lecture.histoire
  if ('vintage_source' in histoire && histoire.vintage_source) {
    return formaterVintage(histoire)
  }
  return null
}
