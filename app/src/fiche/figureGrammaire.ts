/**
 * La grammaire partagée des figures de grille (issue #371, parent #367) — le
 * seam du rendu des puces de rang : le glyphe de direction, la phrase
 * accessible et l'accent discret de position. C'est la brique commune que
 * IndicatorFigure et FigureOffreCyclable consomment pour habiller leur puce de
 * rang de façon identique, sans jamais dupliquer la table de sens des
 * classements.
 *
 * Le sens du classement (plus = mieux / moins = mieux) vient du registre
 * Méthodes (THEMES_METHODES) — la source unique de vérité (ADR-0015, #367) ;
 * l'app ne garde AUCUNE table app-side dupliquée. La puce n'expose jamais le
 * glyphe sans son texte accessible : le glyphe est purement visuel
 * (aria-hidden), la phrase complète (« 3e/41 de l'EPCI — plus = mieux ») porte
 * dans le title ET l'aria-label.
 */

import { LIBELLES_DIRECTION, THEMES_METHODES } from '@/methodes/indicateurs'
import type { DirectionRang } from '@/methodes/indicateurs'
import type { Theme } from '@/payload/types'

/** Le glyphe de direction — ▲ = plus la valeur est haute, meilleur est le rang ; ▼ = l'inverse. */
export type GlypheDirection = '▲' | '▼'

/** Le glyphe d'une direction — jamais rendu sans son texte accessible. */
export function glypheDirection(direction: DirectionRang): GlypheDirection {
  return direction === 'plus-est-mieux' ? '▲' : '▼'
}

/** La puce de rang directionnelle — le glyphe visuel + le rang + la phrase accessible. */
export interface PuceRangDirection {
  /** Le glyphe de direction (« ▲ » / « ▼ »), purement décoratif. */
  glyphe: GlypheDirection
  /** Le rang formaté (« 3e/41 de l'EPCI ») — le texte lisible de la puce. */
  rang: string
  /** La phrase complète pour title + aria-label (« 3e/41 de l'EPCI — plus = mieux »). */
  phrase: string
}

/**
 * La puce de rang, directionnelle : le glyphe accompagne le rang formaté dans
 * le texte visible, la phrase entière (« rang — plus = mieux ») porte dans le
 * title et l'aria-label — le glyphe n'est jamais exposé sans texte accessible.
 */
export function puceRangDirection(rang: string, direction: DirectionRang): PuceRangDirection {
  return {
    glyphe: glypheDirection(direction),
    rang,
    phrase: `${rang} — ${LIBELLES_DIRECTION[direction]}`,
  }
}

/** L'accent discret de position du rang scalaire (issue #371) : le tiers
 *  supérieur du groupe de comparaison lit « fort », le tiers médian « faible »,
 *  le tiers inférieur reste muet. Encre neutre, aucune couleur de statut. */
export type AccentPositionRang = 'fort' | 'faible' | null

export function accentPositionRang(rang: number | null, taille: number | null): AccentPositionRang {
  if (rang === null || taille === null || taille <= 1) return null
  const tiers = taille / 3
  // bornes entières des tiers — le plafond capture le meilleur rang d'un petit
  // groupe (1er/2 reste « fort »), le plancher laisse le dernier tiers muet.
  const haut = Math.ceil(tiers)
  const bas = Math.floor(2 * tiers)
  if (rang <= haut) return 'fort'
  if (rang > bas) return null
  return 'faible'
}

/**
 * La direction du classement d'un indicateur, dérivée du registre Méthodes —
 * la source unique de vérité, jamais une table app-side dupliquée (#367).
 * null quand le thème/clé ne sont pas au registre (un glyphe honnête absent,
 * jamais une devise inventée).
 */
export function directionIndicateur(theme: Theme, clef: string): DirectionRang | null {
  // #408 : le sixième thème n'est pas au registre Méthodes (sa documentation
  // vit dans SA section dédiée) — null = pas de glyphe, jamais une devise.
  const methodes = THEMES_METHODES[theme as keyof typeof THEMES_METHODES]
  return methodes?.indicateurs[clef]?.direction ?? null
}
