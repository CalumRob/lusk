/**
 * Les couleurs officielles de l'étiquette DPE (nouvelle échelle 2021, ADEME) —
 * la figure de composition « distribution_dpe » les consomme telles quelles
 * (#371, issue #367) : un territoire lit la répartition A→G dans les couleurs
 * de référence, jamais dans le dégradé de son thème. La carte est la source
 * unique de vérité (pas de table app-side dupliquée) ; elle vit ici parce
 * qu'elle habille la figure, pas le rendu des histoires.
 */

/** L'ordre canonique des étiquettes DPE — A (meilleur) → G (pire). */
export const ORDRE_DPE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const

/** Une étiquette DPE valide. */
export type EtiquetteDpe = (typeof ORDRE_DPE)[number]

/** La couleur officielle de chaque étiquette (nouvelle échelle 2021). */
export const COULEURS_DPE: Readonly<Record<EtiquetteDpe, string>> = {
  A: '#008659',
  B: '#2BAE6E',
  C: '#C7E600',
  D: '#FFB400',
  E: '#F06D00',
  F: '#E3000F',
  G: '#9B134C',
}

/** La couleur officielle d'une étiquette — null pour une étiquette hors contrat. */
export function couleurDpe(etiquette: string): string | null {
  return (COULEURS_DPE as Record<string, string>)[etiquette] ?? null
}
