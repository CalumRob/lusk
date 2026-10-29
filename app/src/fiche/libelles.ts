/**
 * The fiche's user-facing label seam (issue #318, ownership amended by #827).
 *
 * Native semantic contract labels stay FIRST priority (the caller resolves
 * them before asking here). Otherwise the label is either genuine app-owned
 * EDITORIAL wording (`libellesAffichage.ts`, keyed to the real resource/detail
 * identities) or a producer-owned factual label — thresholds, units/scales,
 * age/year/time bands, reference scope, classification/domain vocabulary —
 * which resolves ONLY from the existing verified producer declaration
 * (`indicator_labels` / `detail_labels`). The app map never overrides a
 * factual label. There is no raw internal key on screen: an unknown label
 * throws, loud — a rendered indicator/detail without any label is a contract
 * break, never a key.
 */

import { LIBELLES_DETAILS_APP, LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
import type { Theme, ThemeMetadata } from '@/payload/types'

function libelleAppIndicateur(theme: Theme, clef: string): string | undefined {
  return LIBELLES_INDICATEURS_APP[theme]?.[clef]
}

function libelleAppDetail(theme: Theme, clef: string, detail: string): string | undefined {
  return LIBELLES_DETAILS_APP[theme]?.[clef]?.[detail]
}

/**
 * The indicator's French label — app-owned editorial wording first, then the
 * verified producer declaration (which owns every fact-bearing label). Throws
 * when neither carries it: never a raw key on screen.
 */
export function libelleIndicateur(metadata: ThemeMetadata, clef: string): string {
  const libelle = libelleAppIndicateur(metadata.theme, clef) ?? metadata.indicator_labels[clef]
  if (libelle === undefined) {
    throw new Error(
      `Libellé d’affichage absent — « ${clef} » n’a pas de libellé éditorial app-owned ni dans indicator_labels de theme_${metadata.theme}.json`,
    )
  }
  return libelle
}

/**
 * The detail's French label — app-owned editorial wording first, then the
 * verified producer declaration (age bands, years, durations, categories).
 * Throws when neither carries it: a detail row without a label is never
 * rendered as a raw detail key.
 */
export function libelleDetail(metadata: ThemeMetadata, clef: string, detail: string): string {
  const libelle = libelleAppDetail(metadata.theme, clef, detail) ?? metadata.detail_labels[clef]?.[detail]
  if (libelle === undefined) {
    throw new Error(
      `Libellé d’affichage absent — le détail « ${detail} » de « ${clef} » n’a pas de libellé éditorial app-owned ni dans detail_labels de theme_${metadata.theme}.json`,
    )
  }
  return libelle
}

/**
 * The reading param's French label — from the theme's param_labels (the exact
 * bijection with the union of subgroups[].reading.params). The carte reads it
 * for the story-scalar layers; a raw histoire field name is never a label.
 */
export function libelleParam(metadata: ThemeMetadata, param: string): string {
  const libelle = metadata.param_labels[param]
  if (libelle === undefined) {
    throw new Error(
      `Libellé payload-owned absent — le paramètre de lecture « ${param} » n'a pas de libellé dans param_labels de theme_${metadata.theme}.json`,
    )
  }
  return libelle
}
