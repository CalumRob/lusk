/**
 * The carte's layer model (ADR-0019 — « la Carte, miroir de la fiche », issue
 * #315, parent #308) : the pure seam that derives the complete grouped layer
 * list of a theme from the PAYLOAD CONTRACT (theme_<theme>.json +
 * indicateurs_<theme>.json + histoires_<theme>.json). Every number a fiche
 * renders is a layer ; the fiche is the contract, the carte never keeps a
 * second vocabulary :
 *
 * - the story scalars lead — the READING PARAMS the theme metadata declares
 *   (subgroups[].reading.params), filtered to the numeric scalar fields of
 *   the resolved histoires rows (one value per territory — a choropleth's
 *   matter). The FIRST declared scalar is the theme's default layer (the α
 *   rule of ADR-0019, re-read from the metadata — « default layers match
 *   declared subgroup primaries ») ; the remaining scalars group under their
 *   subgroup's label (the fiche's subgroup heading, never a carte-side
 *   « La Story » label) ;
 * - the fiche's indicator figures follow in the metadata's indicator_keys
 *   order : a scalar key (detail === null) is one layer, a multi-detail key
 *   (structure_age, DPE, mix…) is ONE expandable entry with a layer per
 *   detail ;
 * - series (conso_enaf, prix_m2) and distribution signatures (the dens_* /
 *   dec_* bins) are excluded — a choropleth needs one value per territory.
 *   The series are named by the ADR itself (ce n'est pas une liste de
 *   couches, c'est la règle d'exclusion de l'ADR).
 *
 * Every layer carries its metadata provenance (sousGroupe — the fiche
 * subgroup that owns the scalar ; storyKey for the story scalars). A payload
 * assembled WITHOUT the metadata seam (merged documents, pre-seam fixtures)
 * has no story layers and no default : the carte mirrors what the contract
 * declares, nothing invented. Labels come from the fiche's OWN shared
 * vocabulary (NOMS_INDICATEURS, the detail-label maps) — never a carte-side
 * list ; a scalar without a label wears its key, the honest fallback.
 */

import type { Histoire, Payload, Theme, ThemeMetadata } from '../payload/types'
import {
  NOMS_DETAILS_OFFRE_CYCLABLE,
  NOMS_DETAILS_RESEAUX,
  NOMS_DETAILS_VOITURES_MENAGE,
  NOMS_INDICATEURS,
  NOMS_TRANCHES_AGE,
} from '../fiche/indicateurs'
import { clesIndicateursDuTheme } from '../payload/selectors'
import type { CoucheProgramme } from './programmesCouches'

/** Where the layer's rows live — the indicateur table or a story scalar. */
export type SourceCouche = 'indicateur' | 'histoire'

/** One mappable layer — a single value per territory. */
export interface Couche {
  source: SourceCouche
  /** The payload key the join reads — an indicateur key or a story scalar field name. */
  clef: string
  /** Non-null for a multi-detail indicateur layer (the detail value it reads). */
  detail: string | null
  /** French label — the fiche's NOMS_INDICATEURS, fallback: the key (never invented). */
  libelle: string
  /** True for the theme's default layer (its first declared story scalar). */
  parDefaut: boolean
  /**
   * La provenance de métadonnées — le sous-groupe de la fiche qui possède la
   * couche (reading.params pour les scalaires de Story, indicators pour les
   * couches d'indicateurs). Null sur un payload sans le seam des métadonnées
   * (la carte ne fabrique jamais une provenance que le contrat ne déclare pas).
   */
  sousGroupe: string | null
  /**
   * La story résolue que la couche lit (reading.story_key) — portée par les
   * scalaires de Story seulement ; null sur les couches d'indicateurs.
   */
  storyKey: string | null
}

/** A layer of the carte — a theme layer (indicateur/histoire) or a programmes
 *  layer (membre/subvention — ADR-0019 #282). Discriminated by `source`. */
export type CoucheCarte = Couche | CoucheProgramme

/** An expandable sidebar entry — the detail-layers of a multi-detail key, or the story-pool siblings. */
export interface GroupeCouches {
  libelle: string
  couches: Couche[]
}

export type EntreeCouches =
  | { type: 'couche'; couche: CoucheCarte }
  | { type: 'groupe'; groupe: GroupeCouches }

export interface CouchesTheme {
  theme: Theme
  /** The sidebar entries, in fiche order: story scalars lead, then the metadata indicator_keys. */
  entrees: EntreeCouches[]
  /** The default layer — the theme's first declared story scalar; null when it has none (Économie). */
  coucheParDefaut: Couche | null
}

/**
 * Les séries temporelles — exclues des couches (ADR-0019 : « a choropleth
 * needs one value per territory »). La fiche rend la série comme évolution ;
 * la carte ne peut pas choroplèther un indicateur multi-millésimes. Nommées
 * par l'ADR (conso_enaf, les millésimes prix_m2) — ce n'est pas une liste de
 * couches, c'est la règle d'exclusion de l'ADR.
 */
const SERIES_EXCLUES: Partial<Record<Theme, readonly string[]>> = {
  habitat: ['prix_m2'],
  milieux: ['conso_enaf_annuel'],
}

/** The fiche's detail-label maps, keyed like the fiche's own figures (OngletTheme.labelsDetailPour). */
const LABELS_DETAILS: Record<string, Record<string, string>> = {
  structure_age: NOMS_TRANCHES_AGE,
  reseaux: NOMS_DETAILS_RESEAUX,
  voitures_menage: NOMS_DETAILS_VOITURES_MENAGE,
  offre_cyclable: NOMS_DETAILS_OFFRE_CYCLABLE,
}

function libelleIndicateur(theme: Theme, clef: string): string {
  return NOMS_INDICATEURS[theme]?.[clef] ?? clef
}

function libelleDetail(clef: string, detail: string): string {
  return LABELS_DETAILS[clef]?.[detail] ?? detail
}

/** The distinct detail values of a multi-detail key, in payload order. */
function detailsDe(payload: Payload, theme: Theme, clef: string): string[] {
  const vus = new Set<string>()
  const details: string[] = []
  for (const ligne of payload.indicateurs) {
    if (ligne.theme === theme && ligne.key === clef && ligne.detail !== null && !vus.has(ligne.detail)) {
      vus.add(ligne.detail)
      details.push(ligne.detail)
    }
  }
  return details
}

/** Un paramètre de lecture déclaré est mappable s'il est un champ NUMÉRIQUE
 *  des lignes d'histoires résolues du thème (une valeur par territoire — le
 *  filtre « un choroplèthe a besoin d'une valeur par territoire »). Les
 *  paramètres de texte (periode, classification, …) et les clés repliées
 *  (Économie : rang, lq, n — jamais des champs de ligne) ne sont jamais des
 *  couches. */
function estScalaireNumerique(histoiresDuTheme: Histoire[], champ: string): boolean {
  return histoiresDuTheme.some(
    (histoire) => typeof (histoire as unknown as Record<string, unknown>)[champ] === 'number',
  )
}

/** Un scalaire de Story déclaré par les métadonnées — avec sa provenance. */
interface ScalaireStory {
  champ: string
  sousGroupe: string
  libelleSousGroupe: string
  storyKey: string
}

/**
 * Les scalaires de Story de la theme metadata — les params de lecture
 * DÉCLARÉS (subgroups[].reading.params), filtrés aux champs numériques des
 * lignes d'histoires résolues, dans l'ordre déclaré (sous-groupes puis
 * params). Chaque scalaire porte sa provenance : le sous-groupe qui le
 * déclare et la story résolue qu'il lit. Un param déclaré deux fois n'est
 * émis qu'une fois (la première déclaration fait foi).
 */
function scalairesStoryDe(metadata: ThemeMetadata, histoiresDuTheme: Histoire[]): ScalaireStory[] {
  const vus = new Set<string>()
  const scalaires: ScalaireStory[] = []
  for (const sousGroupe of metadata.subgroups) {
    for (const champ of sousGroupe.reading.params) {
      if (vus.has(champ)) continue
      if (!estScalaireNumerique(histoiresDuTheme, champ)) continue
      vus.add(champ)
      scalaires.push({
        champ,
        sousGroupe: sousGroupe.key,
        libelleSousGroupe: sousGroupe.label,
        storyKey: sousGroupe.reading.story_key,
      })
    }
  }
  return scalaires
}

/**
 * The complete grouped layer list of a theme — payload in, the fiche's
 * mappable figures out. The story scalars come from the metadata's declared
 * reading params (a key that is BOTH a story scalar and an indicateur scalar
 * — part_passoires lives in both tables — is emitted once, as the story
 * scalar, reading the indicateur rows: the richer join, value + ranks +
 * vintage, never a second layer). The indicator layers follow the metadata's
 * indicator_keys order (payload order for a payload without the metadata
 * seam).
 */
export function couchesDuTheme(payload: Payload, theme: Theme): CouchesTheme {
  const metadata = payload.themeMetadata?.[theme]
  const histoiresDuTheme = payload.histoires.filter((histoire) => histoire.theme === theme)
  const aDesHistoires = histoiresDuTheme.length > 0

  // Les scalaires de Story — les params de lecture déclarés par les
  // métadonnées, filtrés aux champs numériques des lignes résolues.
  const scalairesStory = metadata && aDesHistoires ? scalairesStoryDe(metadata, histoiresDuTheme) : []

  // L'ordre des figures d'indicateurs — le registre des métadonnées (l'ordre
  // de la fiche, payload-owned) ; l'ordre du payload pour un payload sans le
  // seam des métadonnées.
  const clesIndicateurs = metadata
    ? metadata.indicator_keys.filter((clef) =>
        payload.indicateurs.some((ligne) => ligne.theme === theme && ligne.key === clef),
      )
    : clesIndicateursDuTheme(payload, theme)

  const scalairesIndicateurs = new Set<string>()
  for (const clef of clesIndicateurs) {
    if (SERIES_EXCLUES[theme]?.includes(clef)) continue
    if (payload.indicateurs.some((l) => l.theme === theme && l.key === clef && l.detail === null)) {
      scalairesIndicateurs.add(clef)
    }
  }

  /** Le sous-groupe qui possède une clé d'indicateur (la provenance). */
  function sousGroupeDe(clef: string): string | null {
    if (!metadata) return null
    return metadata.subgroups.find((sousGroupe) => sousGroupe.indicators.includes(clef))?.key ?? null
  }

  /** La couche d'un scalaire de Story — lue depuis les indicateurs quand la
   *  clé y vit aussi (la jointure riche : valeur + rang + vintage). */
  function coucheStory(scalaire: ScalaireStory, parDefaut: boolean): Couche {
    return {
      source: scalairesIndicateurs.has(scalaire.champ) ? 'indicateur' : 'histoire',
      clef: scalaire.champ,
      detail: null,
      libelle: libelleIndicateur(theme, scalaire.champ),
      parDefaut,
      sousGroupe: scalaire.sousGroupe,
      storyKey: scalaire.storyKey,
    }
  }

  const entrees: EntreeCouches[] = []
  let coucheParDefaut: Couche | null = null

  if (scalairesStory.length > 0) {
    // Le défaut — le PREMIER scalaire déclaré (la « primary » du sous-groupe,
    // l'α rule d'ADR-0019 re-lue depuis les métadonnées).
    coucheParDefaut = coucheStory(scalairesStory[0], true)
    entrees.push({ type: 'couche', couche: coucheParDefaut })

    // Les scalaires au-delà du défaut — groupés par sous-groupe (le label de
    // la fiche, jamais un label carte-side). L'ordre d'insertion est l'ordre
    // déclaré (les sous-groupes des métadonnées).
    const groupesParSousGroupe = new Map<string, GroupeCouches>()
    for (const scalaire of scalairesStory.slice(1)) {
      let groupe = groupesParSousGroupe.get(scalaire.sousGroupe)
      if (!groupe) {
        groupe = { libelle: scalaire.libelleSousGroupe, couches: [] }
        groupesParSousGroupe.set(scalaire.sousGroupe, groupe)
      }
      groupe.couches.push(coucheStory(scalaire, false))
    }
    for (const groupe of groupesParSousGroupe.values()) {
      entrees.push({ type: 'groupe', groupe })
    }
  }

  for (const clef of clesIndicateurs) {
    if (SERIES_EXCLUES[theme]?.includes(clef)) continue
    // les story scalars sont déjà émis (part_passoires est dans les deux tables)
    if (scalairesStory.some((scalaire) => scalaire.champ === clef)) continue
    if (scalairesIndicateurs.has(clef)) {
      entrees.push({
        type: 'couche',
        couche: {
          source: 'indicateur',
          clef,
          detail: null,
          libelle: libelleIndicateur(theme, clef),
          parDefaut: false,
          sousGroupe: sousGroupeDe(clef),
          storyKey: null,
        },
      })
    } else {
      entrees.push({
        type: 'groupe',
        groupe: {
          libelle: libelleIndicateur(theme, clef),
          couches: detailsDe(payload, theme, clef).map((detail) => ({
            source: 'indicateur',
            clef,
            detail,
            libelle: libelleDetail(clef, detail),
            parDefaut: false,
            sousGroupe: sousGroupeDe(clef),
            storyKey: null,
          })),
        },
      })
    }
  }

  return { theme, entrees, coucheParDefaut }
}
