/**
 * The carte's layer model (ADR-0019 — « la Carte, miroir de la fiche ») : the
 * pure seam that derives the complete grouped layer list of a theme from the
 * payload. Every number a fiche renders is a layer :
 *
 * - the story scalars (histoires_<theme>.json, via the SCALAIRES_STORY
 *   declaration — the fiche's own contract order) lead the list, the FIRST
 *   scalar being the theme's default layer (the α rule of ADR-0019) ;
 * - the fiche's indicator figures follow in ORDRE_INDICATEURS order : a
 *   scalar key (detail === null) is one layer, a multi-detail key
 *   (structure_age, DPE, mix…) is ONE expandable entry with a layer per
 *   detail ;
 * - series (conso_enaf, prix_m2) and distribution signatures (the dens_* /
 *   dec_* bins) are excluded — a choropleth needs one value per territory.
 *
 * Order and French labels come from the fiche's OWN sources of truth
 * (ORDRE_INDICATEURS, NOMS_INDICATEURS, the detail-label maps) — never a
 * carte-side list. The fiche is the contract.
 */

import type { Payload, Theme } from '../payload/types'
import {
  NOMS_DETAILS_OFFRE_CYCLABLE,
  NOMS_DETAILS_RESEAUX,
  NOMS_DETAILS_VOITURES_MENAGE,
  NOMS_INDICATEURS,
  NOMS_TRANCHES_AGE,
} from '../fiche/indicateurs'
import { SCALAIRES_STORY } from '../fiche/storyScalaires'
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
  /** True for the theme's default layer (its first story scalar). */
  parDefaut: boolean
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
  /** The sidebar entries, in fiche order: story scalars lead, then ORDRE_INDICATEURS. */
  entrees: EntreeCouches[]
  /** The default layer — the theme's first story scalar; null when it has none (Économie). */
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

/** La Story-pool group label — the story scalars beyond the default (ADR-0019 : « grouped sidebar layers »). */
const LIBELLE_GROUPE_STORY = 'La Story'

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

/**
 * The complete grouped layer list of a theme — payload in, the fiche's
 * mappable figures out. A key that is BOTH a story scalar and an indicateur
 * scalar (part_passoires lives in both tables) is emitted once, as the story
 * scalar, reading the indicateur rows (the richer join — value + ranks +
 * vintage, never a second layer).
 */
export function couchesDuTheme(payload: Payload, theme: Theme): CouchesTheme {
  const scalairesStory: readonly string[] = SCALAIRES_STORY[theme]
  const aDesHistoires = payload.histoires.some((h) => h.theme === theme)

  const clesIndicateurs = clesIndicateursDuTheme(payload, theme)
  const scalairesIndicateurs = new Set<string>()
  for (const clef of clesIndicateurs) {
    if (SERIES_EXCLUES[theme]?.includes(clef)) continue
    if (payload.indicateurs.some((l) => l.theme === theme && l.key === clef && l.detail === null)) {
      scalairesIndicateurs.add(clef)
    }
  }

  const entrees: EntreeCouches[] = []
  let coucheParDefaut: Couche | null = null

  const storyCouches: Couche[] = aDesHistoires
    ? scalairesStory.map((champ, index) => ({
        source: scalairesIndicateurs.has(champ) ? 'indicateur' : 'histoire',
        clef: champ,
        detail: null,
        libelle: libelleIndicateur(theme, champ),
        parDefaut: index === 0,
      }))
    : []
  if (storyCouches.length > 0) {
    coucheParDefaut = storyCouches[0]
    entrees.push({ type: 'couche', couche: storyCouches[0] })
    if (storyCouches.length > 1) {
      entrees.push({ type: 'groupe', groupe: { libelle: LIBELLE_GROUPE_STORY, couches: storyCouches.slice(1) } })
    }
  }

  for (const clef of clesIndicateurs) {
    if (SERIES_EXCLUES[theme]?.includes(clef)) continue
    // les story scalars sont déjà émis (part_passoires est dans les deux tables)
    if (scalairesStory.includes(clef)) continue
    if (scalairesIndicateurs.has(clef)) {
      entrees.push({
        type: 'couche',
        couche: {
          source: 'indicateur',
          clef,
          detail: null,
          libelle: libelleIndicateur(theme, clef),
          parDefaut: false,
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
          })),
        },
      })
    }
  }

  return { theme, entrees, coucheParDefaut }
}
