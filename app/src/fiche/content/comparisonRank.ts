import type { NumericFact } from './territoryFacts'
import { puceRangDirection } from '../figureGrammaire'
import { formatServedRank } from '../cahierFigureGrammaire'

/** Presentation only: positions and sizes come from the active comparison read. */
export function comparisonRank(fact: NumericFact) {
  const comparison = fact.comparison
  const rank = comparison?.rank
  const text = formatServedRank(rank)
  if (!comparison || !text) return null
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const puce = puceRangDirection(text, comparison.direction)
  return { ...puce,
    phrase: `${puce.phrase}${comparison.scope.label ? `. ${statistic} des ${comparison.scope.label}` : ''}.`,
  }
}
