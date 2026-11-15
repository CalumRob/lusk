import type { CahierGroupedVerticalBarFigureData, CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'

export function formatGroupedBarValue(figure: CahierGroupedVerticalBarFigureData, value: number): string {
  return figure.formatValue?.(value) ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

/** One owner-resolved category, shared by the live tooltip and PDF table. */
export function groupedBarTooltipRows(
  figure: CahierGroupedVerticalBarFigureData,
  categoryIndex: number | null,
): readonly (CahierTooltipRow & { seriesKey: string })[] {
  if (categoryIndex === null) return []
  const comparedSeries = new Map(figure.series.filter(series => series.comparisonFor)
    .map(series => [series.comparisonFor!, series]))
  const display = (value: number | null | undefined) => value === null || value === undefined
    ? 'Indisponible' : formatGroupedBarValue(figure, value)
  return figure.series.filter(series => !series.comparisonFor).map(series => {
    const compared = comparedSeries.get(series.key)
    return {
      seriesKey: series.key, label: series.label, value: display(series.values[categoryIndex]),
      icon: series.icon, markerColor: series.color,
      ...(compared ? { comparison: {
        value: display(compared.values[categoryIndex]),
        rank: formatServedRank(compared.ranks?.[categoryIndex]),
        rankAria: formatServedRankAria(compared.ranks?.[categoryIndex]),
      } } : {}),
    }
  })
}
