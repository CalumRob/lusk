import type { NumericFact } from './territoryFacts'
import { formatServedRank, formatServedRankAria, puceRangDirection } from '../figureGrammaire'

/** Presentation only: positions, sizes and ties come from the active comparison read. */
export function comparisonRank(fact: NumericFact) {
  const comparison = fact.comparison
  const rank = comparison?.rank
  if (!comparison || !rank || rank.size < 2) return null
  const text = formatServedRank(rank)
  const accessible = formatServedRankAria(rank)
  if (!text || !accessible) return null
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  // The visible chip carries the served « = » tie marker; the accessible phrase
  // spells the tie out (« ex æquo ») instead of reading the symbol aloud.
  const phrase = puceRangDirection(accessible, comparison.direction).phrase
  const puce = puceRangDirection(text, comparison.direction)
  return { ...puce,
    phrase: `${phrase}${comparison.scope.label ? `. ${statistic} des ${comparison.scope.label}` : ''}.`,
  }
}
