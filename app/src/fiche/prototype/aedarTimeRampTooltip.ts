import type { TimeRampFigureData, TimeRampPoint } from '@/fiche/content/territoryFacts'
import type { CahierTooltipRow, CahierTooltipTone } from '@/fiche/cahierFigureGrammaire'
import { groupeCompareAria } from '@/fiche/content/comparisonWording'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import { AEDAR_TIME_MODE_ICONS } from './aedarTimeModeIcons'

const tones: Readonly<Record<string, CahierTooltipTone>> = {
  car: 'c', bike_lts4: 'b', bike_lts2: 'b', transit: 't', walk: 't',
}
export function formatTimeRampNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}
function tooltipValue(value: number | null, unit: string) {
  if (value === null) return { visible: 'Indisponible', aria: 'Indisponible' }
  const number = formatTimeRampNumber(value)
  return { visible: number, aria: unit ? `${number} ${unit}` : number }
}

/** Same resolved presentation model for an interactive cut and a PDF table row. */
export function timeRampTooltipRows(
  timeRamp: TimeRampFigureData | undefined,
  series: TimeRampFigureData['series'],
  cut: Pick<TimeRampPoint, 'xValue'> | null,
  territoryName: string,
  comparisonLayerSupported: boolean,
): readonly (CahierTooltipRow & { seriesKey: string })[] {
  if (!cut || !timeRamp) return []
  return series.flatMap((series) => {
    const point = series.points.find((candidate) => candidate.xValue === cut.xValue)
    if (!point) return []
    const value = tooltipValue(point.value, timeRamp.yAxis.unit)
    const row: CahierTooltipRow & { seriesKey: string } = {
      seriesKey: series.key,
      label: series.label, value: value.visible, tone: tones[series.key] ?? 'neutral',
      icon: AEDAR_TIME_MODE_ICONS[series.key],
      markerColor: AEDAR_TIME_MODE_COLORS[series.key] ?? 'var(--cahier-theme-strong)',
      ariaLabel: `${territoryName} : ${series.label} : ${value.aria}`,
    }
    if (comparisonLayerSupported) {
      const compared = tooltipValue(point.referenceValue, timeRamp.yAxis.unit)
      row.comparison = {
        value: compared.visible, rank: formatServedRank(point.referenceRank),
        ariaLabel: groupeCompareAria(compared.aria, formatServedRankAria(point.referenceRank), timeRamp.comparisonLabel ?? 'Indisponible'),
      }
    }
    return [row]
  })
}
