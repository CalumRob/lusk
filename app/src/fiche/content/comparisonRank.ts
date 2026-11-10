import type { NumericFact } from './territoryFacts'
import { puceRangDirection } from '../figureGrammaire'

/** Presentation only: positions and sizes come from the active comparison read. */
export function comparisonRank(fact: NumericFact) {
  const comparison = fact.comparison
  const rank = comparison?.rank
  if (!comparison || !rank || rank.size < 2) return null
  const text = `${rank.position === 1 ? '1er' : `${rank.position}e`}/${rank.size}`
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const puce = puceRangDirection(text, comparison.direction)
  return { ...puce,
    phrase: `${puce.phrase}${comparison.scope.label ? `. ${statistic} des ${comparison.scope.label}` : ''}.`,
  }
}
