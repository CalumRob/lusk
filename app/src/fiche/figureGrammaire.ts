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

/** La puce de rang directionnelle — le glyphe visuel et les deux formes du rang. */
export interface PuceRangDirection {
  /** Le glyphe de direction (« ▲ » / « ▼ »), purement décoratif. */
  glyphe: GlypheDirection
  /** Le rang visible (« =1er/41 · communes de l'EPCI ») — le « = » marque un rang partagé. */
  rang: string
  /** Le même rang pour les technologies d'assistance (« 1er/41 (ex æquo) · … »). */
  rangAria: string
  /** La phrase du title, en forme visible (« =1er/41 — plus = mieux »). */
  phrase: string
  /** La phrase du nom accessible, en forme parlée (« 1er/41 (ex æquo) — plus = mieux »). */
  phraseAria: string
}

/**
 * La puce de rang : le rang servi est formaté une seule fois, en deux formes.
 * Le texte visible garde le marqueur « = » d'un rang partagé ; la phrase
 * accessible dit « ex æquo » et ne lit jamais le symbole. `scope` est la portée
 * déclarée par le producteur, ajoutée aux deux formes.
 */
export function puceRangDirection(
  rank: { position: number; size: number; ties?: number | null } | null | undefined,
  direction: DirectionRang,
  scope?: string | null,
): PuceRangDirection | null {
  const rang = formatServedRank(rank)
  const rangAria = formatServedRankAria(rank)
  if (!rang || !rangAria) return null
  const suffixe = scope ? ` · ${scope}` : ''
  const label = `${LIBELLES_DIRECTION[direction]}`
  return {
    glyphe: glypheDirection(direction),
    rang: `${rang}${suffixe}`,
    rangAria: `${rangAria}${suffixe}`,
    phrase: `${rang}${suffixe} — ${label}`,
    phraseAria: `${rangAria}${suffixe} — ${label}`,
  }
}

/** L'accent discret de position du rang scalaire (issue #371) : le tiers
 *  supérieur du groupe de comparaison lit « fort », le tiers médian « faible »,
 *  le tiers inférieur reste muet. Encre neutre, aucune couleur de statut. */
export type AccentPositionRang = 'fort' | 'faible' | null

/** A rank is only displayable against a comparison population of at least
 *  two: a served `1/1` is real evidence but has no position to show, so every
 *  display surface folds it to nothing (owner decision 2026-11-11, #958). The
 *  transport validation accepts `rank_size >= 1` independently. */
export const RANK_DISPLAY_MIN_SIZE = 2

/**
 * Formate un rang servi par le producteur (« 1er/3 », « 2e/3 », « =1er/3 » quand
 * le rang est partagé) — jamais dérivé des faits locaux. Le type reste
 * structurel : `ComparisonRank` le satisfait. La taille du groupe est toujours
 * affichée : un rang sans population publiée n'est pas rendu.
 */
export function formatServedRank(
  rank: { position: number; size: number; ties?: number | null } | null | undefined,
): string | null {
  if (!rank) return null
  const { position, size, ties } = rank
  if (!Number.isInteger(position) || !Number.isInteger(size)) return null
  if (position < 1 || size < RANK_DISPLAY_MIN_SIZE || position > size) return null
  const shared = typeof ties === 'number' && Number.isInteger(ties) && ties > 1
  return `${shared ? '=' : ''}${position === 1 ? '1er' : `${position}e`}/${size}`
}

/** Le même rang pour les technologies d'assistance : le « = » visible devient « ex æquo ». */
export function formatServedRankAria(
  rank: { position: number; size: number; ties?: number | null } | null | undefined,
): string | null {
  const text = formatServedRank(rank)
  if (!text) return null
  return text.startsWith('=') ? `${text.slice(1)} (ex æquo)` : text
}

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
