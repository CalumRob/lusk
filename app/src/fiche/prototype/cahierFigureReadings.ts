/**
 * Pure readings shared by the Cahier figures and the export projections (#1022).
 *
 * A reading is resolved once from the native figure model and then consumed by
 * the visible tooltip, the accessible name and — through the export adapters —
 * the PDF table. None of these builders touch Vue state, the DOM or an
 * acquisition owner.
 */
import type {
  CahierGroupedVerticalBarFigureData,
  CahierGroupedVerticalBarSeries,
  CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import type { ComparisonRank } from '@/fiche/content/territoryFacts'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'

export const CAHIER_UNAVAILABLE_LABEL = 'Indisponible'

/** The one visible-value formatter of the grouped-bar family. */
export function groupedBarValue(figure: CahierGroupedVerticalBarFigureData, value: number): string {
  return figure.formatValue?.(value)
    ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

/** The accessible reading of the same value: the unit lives here, not in the row. */
export function groupedBarAriaValue(figure: CahierGroupedVerticalBarFigureData, value: number): string {
  return figure.formatAriaValue?.(value) ?? groupedBarValue(figure, value)
}

/**
 * A visible grouped-bar series. A comparison attached to a hidden focal series
 * is hidden with it: no tooltip/table row may survive on its own.
 */
export function visibleGroupedBarSeries(
  figure: CahierGroupedVerticalBarFigureData,
  hiddenSeriesKeys: readonly string[] = [],
): readonly CahierGroupedVerticalBarSeries[] {
  const hidden = new Set(hiddenSeriesKeys)
  return figure.series.filter((series) =>
    !hidden.has(series.key)
    && (!series.comparisonFor || !hidden.has(series.comparisonFor)),
  )
}

/** One owner-resolved category row, shared by the live tooltip and the PDF table. */
export interface CahierGroupedBarReading extends CahierTooltipRow {
  readonly categoryKey: string
  readonly seriesKey: string
  /** Exact native value; null stays absent, never zero. */
  readonly numericValue: number | null
  readonly comparisonValue: number | null
  readonly comparisonRank: ComparisonRank | null
}

export function groupedBarTooltipRows(
  figure: CahierGroupedVerticalBarFigureData,
  categoryIndex: number | null,
  hiddenSeriesKeys: readonly string[] = [],
): readonly CahierGroupedBarReading[] {
  if (categoryIndex === null) return []
  const visible = visibleGroupedBarSeries(figure, hiddenSeriesKeys)
  const comparedSeries = new Map(
    visible
      .filter((series) => series.comparisonFor)
      .map((series) => [series.comparisonFor!, series]),
  )
  return visible
    .filter((series) => !series.comparisonFor)
    .map((series) => {
      const value = series.values[categoryIndex]
      const comparison = comparedSeries.get(series.key)
      const comparisonValue = comparison?.values[categoryIndex]
      const comparisonRank = comparison?.ranks?.[categoryIndex] ?? null
      return {
        categoryKey: figure.categories[categoryIndex]!.key,
        seriesKey: series.key,
        label: series.label,
        value: value === null || value === undefined
          ? CAHIER_UNAVAILABLE_LABEL
          : groupedBarValue(figure, value),
        icon: series.icon,
        markerColor: series.color,
        numericValue: value === null || value === undefined ? null : value,
        comparisonValue: comparisonValue === null || comparisonValue === undefined
          ? null : comparisonValue,
        comparisonRank,
        ...(comparison
          ? {
              comparison: {
                value: comparisonValue === null || comparisonValue === undefined
                  ? CAHIER_UNAVAILABLE_LABEL
                  : groupedBarValue(figure, comparisonValue),
                rank: formatServedRank(comparisonRank),
                rankEvidence: comparisonRank,
                rankAria: formatServedRankAria(comparisonRank),
              },
            }
          : {}),
      }
    })
}

/**
 * The category's accessible reading. It derives from the same visible series
 * list as the tooltip, so a hidden comparison cannot reappear here.
 */
export function groupedBarCategoryAria(
  figure: CahierGroupedVerticalBarFigureData,
  categoryIndex: number,
  hiddenSeriesKeys: readonly string[] = [],
): string {
  const category = figure.categories[categoryIndex]!
  const values = visibleGroupedBarSeries(figure, hiddenSeriesKeys).map((series) => {
    const value = series.values[categoryIndex]
    return `${series.label} : ${value === null || value === undefined
      ? CAHIER_UNAVAILABLE_LABEL
      : groupedBarAriaValue(figure, value)}`
  })
  return `${category.label} : ${values.length ? values.join(' ; ') : 'Aucune série'}`
}

export function groupedBarAccessibleLabel(
  figure: CahierGroupedVerticalBarFigureData,
  hiddenSeriesKeys: readonly string[] = [],
): string {
  const seriesReadings = visibleGroupedBarSeries(figure, hiddenSeriesKeys)
    .map((series) => `${series.label} : ${series.values.map((value) =>
      value === null || !Number.isFinite(value)
        ? CAHIER_UNAVAILABLE_LABEL
        : groupedBarAriaValue(figure, value)).join(', ')}`)
    .join(' ; ')
  return `${figure.description} Axe horizontal : ${figure.xAxisTitle}. Axe vertical : ${figure.yAxisTitle}. ${seriesReadings}`
}
