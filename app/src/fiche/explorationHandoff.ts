/**
 * La passarelle « Explorer » (#409 ; le libellé compact est #468) — le
 * handoff fiche → Page
 * d'indicateur. Le contrat (CONTEXT.md, Page d'indicateur) : la passarelle
 * emporte SON territoire comme état explicite de l'URL — il reste mis en
 * avant à travers Repères et Carte jusqu'à ce qu'il soit effacé ou remplacé —
 * et son niveau quand il est comparable (commune / EPCI / département). La
 * Région est exclue de la comparaison data-first : son handoff porte le
 * territoire SANS niveau — la page résout alors son repli honnête et nomme
 * « absent à ce niveau » un territoire hors périmètre, jamais une invention.
 * La facette (détail comparé, sexe…), elle, n'est PAS portée : la page résout
 * SA facette canon déclarée par le descripteur.
 *
 * Règle d'honnêteté verrouillée par test : un indicateur SANS page publiée
 * (`indicator_pages`) ne porte AUCUNE passarelle — jamais un lien mort vers
 * une famille de page non supportée. L'affordance rendue (libellé compact,
 * nouvelle fenêtre, vraie ancre) vit dans PassarelleExploration.vue (#468).
 */

import type { TerritoireType, ThemeMetadata } from '@/payload/types'
import type { RouteLocationRaw } from 'vue-router'

/** Le libellé unique du handoff — la microcopie compacte (#468), la copie
 *  française du produit ; le composant partagé PassarelleExploration la rend
 *  à l'identique sur chaque site. */
export const LIBELLE_HANDOFF = 'Explorer'

/** Les niveaux comparables d'une Page d'indicateur (la Région n'y figure pas). */
const NIVEAUX_COMPARABLES: ReadonlySet<string> = new Set(['commune', 'epci', 'departement'])

export function handoffExploration(
  metadata: ThemeMetadata | null | undefined,
  clef: string,
  territoire: { territoire: string; type: TerritoireType } | null | undefined,
): RouteLocationRaw | null {
  const theme = metadata?.theme
  if (!theme || !metadata.indicator_pages?.[clef]) return null

  const query: Record<string, string> = {}
  if (territoire) {
    query.territoire = territoire.territoire
    if (NIVEAUX_COMPARABLES.has(territoire.type)) query.niveau = territoire.type
  }
  return { name: 'indicateur', params: { theme, indicator: clef }, query }
}
