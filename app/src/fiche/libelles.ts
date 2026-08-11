/**
 * The payload-owned label seam (issue #318) — the ONLY way the fiche and the
 * carte obtain a user-facing label: read it from the theme's metadata maps
 * (theme_<theme>.json → indicator_labels / detail_labels / param_labels).
 * There is no fallback to a raw internal key: the strict validators
 * (validerThemeMetadata) and the load-time parity guard (verifierPariteLibelles,
 * loader.ts) guarantee the label exists for every rendered key and detail —
 * a missing label is a contract violation, loud, never a key on screen.
 */

import type { ThemeMetadata } from '@/payload/types'

/**
 * The indicator's French label — from the theme's indicator_labels (the exact
 * bijection with indicator_keys). Throws when absent: a rendered indicator
 * without its payload-owned label is a broken metadata file, never a raw key.
 */
export function libelleIndicateur(metadata: ThemeMetadata, clef: string): string {
  const libelle = metadata.indicator_labels[clef]
  if (libelle === undefined) {
    throw new Error(
      `Libellé payload-owned absent — « ${clef} » n'a pas de libellé dans indicator_labels de theme_${metadata.theme}.json`,
    )
  }
  return libelle
}

/**
 * The detail's French label — from the theme's detail_labels. Throws when
 * absent (the parity guard would have refused the payload at load): a detail
 * row without its label is never rendered as a raw detail key.
 */
export function libelleDetail(metadata: ThemeMetadata, clef: string, detail: string): string {
  const carte = metadata.detail_labels[clef]
  const libelle = carte?.[detail]
  if (libelle === undefined) {
    throw new Error(
      `Libellé payload-owned absent — le détail « ${detail} » de « ${clef} » n'a pas de libellé dans detail_labels de theme_${metadata.theme}.json`,
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
