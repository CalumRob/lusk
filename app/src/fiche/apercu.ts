/**
 * The Aperçu tab's display vocabulary (CONTEXT.md §Aperçu + ADR-0007) — the
 * French labels and number formatting that turn the pipeline's `apercu` rows
 * into the figures the tab renders, and the typed shape of the Programmes &
 * financements element (CONTEXT.md §Programmes & financements).
 *
 * This is the DISPLAY layer, not the payload layer: the selectors (payload/
 * selectors.ts) stay the single seam for raw payload → French strings, and
 * this module owns what a figure looks like and what a programme is. Labels
 * mirror the pipeline's own declared libellés (pipeline/R/theme_demographie.R
 * §APERCU_DEMOGRAPHIE) so the app never invents a second set of names.
 *
 * The pipeline stores percentages as fractions in [0,1] (unit « % », value
 * 0.15 = 15 %) — same convention as ranks and the structure_age indicateurs.
 * formaterValeurApercu is where that convention becomes the figure « 15 % »,
 * never « 0,15 % ».
 */

import type { ApercuRow } from '@/payload/types'

/** The Aperçu keys' French labels — the pipeline's declared libellés, verbatim. */
const LIBELLES_APERCU: Record<string, string> = {
  population: 'Population',
  densite: 'Densité de population',
  part_65_plus: 'Part des 65 ans et plus',
}

/** The label of an Aperçu key — the raw key as the honest fallback. */
export function libelleApercu(key: string): string {
  return LIBELLES_APERCU[key] ?? key
}

/** French number formatting: « 2 000 », « 133 » — digits never jitter (DESIGN.md §3). */
const FORMATEUR_NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

/**
 * The basic-stat figure for one apercu row: value + unit, percentages read
 * as fractions × 100. A null value (never rendered — apercuPourTerritoire
 * NA-gates it) yields an empty string rather than a phantom figure.
 */
export function formaterValeurApercu(ligne: ApercuRow): string {
  if (ligne.value === null) return ''
  const brut = ligne.unit === '%' ? ligne.value * 100 : ligne.value
  return `${FORMATEUR_NOMBRE.format(brut)} ${ligne.unit}`
}

/**
 * Un programme d'État ou régional couvrant le territoire (CONTEXT.md
 * §Programmes & financements) — l'adhésion affichée, jamais un résultat.
 *
 * The payload seam does NOT expose a programmes table yet (C2 builds the
 * element's PRESENTATION first). This typed shape is the interface the future
 * pipeline table fills: sigle = what the badge shows (ACV, PVD, CRTE…), nom =
 * the full name given as the accessible expansion.
 */
export interface Programme {
  /** Le sigle affiché sur le badge (ex. « ACV », « PVD »). */
  sigle: string
  /** Le nom complet (ex. « Action Cœur de Ville ») — l'expansion accessible. */
  nom: string
}

/** L'expansion accessible d'un programme — « ACV — Action Cœur de Ville ». */
export function libelleProgramme(programme: Programme): string {
  return programme.sigle === programme.nom
    ? programme.sigle
    : `${programme.sigle} — ${programme.nom}`
}

/** Le lien « Région subventions » de l'élément — le portail officiel des aides. */
export const LIEN_SUBVENTIONS = {
  libelle: 'Subventions de la Région Bretagne',
  href: 'https://www.bretagne.bzh/aides/',
} as const
