import type { NumericFact } from './territoryFacts'
import { RANK_DISPLAY_MIN_SIZE, puceRangDirection } from '../figureGrammaire'

/** Presentation only: positions, sizes and ties come from the active comparison read. */
export function comparisonRank(fact: NumericFact) {
  const comparison = fact.comparison
  const rank = comparison?.rank
  if (!comparison || !rank || rank.size < RANK_DISPLAY_MIN_SIZE) return null
  const puce = puceRangDirection(rank, comparison.direction)
  if (!puce) return null
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const scope = comparison.scope.label
  return {
    ...puce,
    phrase: `${puce.phrase}${scope ? `. ${statistic} des ${scope}` : ''}.`,
    phraseAria: `${puce.phraseAria}${scope ? `. ${statistic} des ${scope}` : ''}.`,
  }
}
