/**
 * Pure AEDAR figure readings shared by the native screens and the export
 * projections (#1022).
 *
 * These builders wrap the same owner resolvers the components already use —
 * `aedarGroupValue`, the source-clock/coverage guard, `readAedarCountMeasure`,
 * `classifyAedarEquipmentTypes` and the producer-served ranks — so a table can
 * never disagree with the tooltip or the accessible name.
 */
import type { AedarFact } from '@/fiche/content/aedarApiClient'
import {
  aedarComparisonCell,
  aedarComparisonRank,
  aedarGroupValue,
} from '@/fiche/content/aedarComparisonClient'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import {
  AEDAR_EQUIPMENT_BUCKET_HORIZONS,
  AEDAR_EQUIPMENT_MODES,
  aedarEquipmentShareMeasureKey,
  classifyAedarEquipmentTypes,
} from '@/fiche/content/aedarEquipmentBuckets'
import type {
  AedarEquipmentBuckets,
  AedarEquipmentHorizon,
  AedarEquipmentModeKey,
} from '@/fiche/content/aedarEquipmentBuckets'
import {
  AEDAR_RAMP_MODE_LABELS,
  AEDAR_RAMP_MODES,
  readAedarCountMeasure,
} from '@/fiche/content/aedarTimeRampFacts'
import type {
  AedarCarAccessOverviewEvidence,
  AedarCarAccessOverviewScalar,
  AedarEquipmentExplorerEvidence,
  AedarRampMode,
  AedarTimeRampEvidence,
} from '@/fiche/content/themeContent'
import type { ComparisonRank, FactAvailability, TimeRampFigureData, TimeRampSeries } from '@/fiche/content/territoryFacts'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import { AEDAR_TIME_MODE_ICONS } from './aedarTimeModeIcons'

export const AEDAR_UNAVAILABLE_LABEL = 'Indisponible'

/** The mechanical evidence-to-ramp conversion shared by the screen and the export. */
export function aedarRampToTimeRampFigureData(
  ramp: AedarTimeRampEvidence,
  comparisonLayerSupported: boolean,
): TimeRampFigureData {
  const series: readonly TimeRampSeries[] = AEDAR_RAMP_MODES.map((mode) => ({
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    points: ramp.xAxis.values.map((xValue, index) => ({
      xValue,
      xLabel: ramp.xAxis.labels[index] ?? `${xValue}`,
      value: ramp.territory[mode][index] ?? null,
      referenceValue: ramp.reference?.[mode][index] ?? null,
      referenceRank: ramp.referenceRanks?.[mode][index] ?? null,
    })),
  }))
  return {
    availability: ramp.availability,
    xAxis: { label: ramp.xAxis.label, unit: ramp.xAxis.unit },
    yAxis: { label: ramp.yAxis.label, unit: ramp.yAxis.unit },
    series,
    provenance: ramp.provenance,
    comparisonLabel: ramp.referenceLabel,
    comparisonLayerSupported,
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

/* ------------------------------------------------------------------ *
 * Equipment distribution (grouped AEDAR bars: min / deciles / max)
 * ------------------------------------------------------------------ */

export interface AedarQuantileReadingInput {
  readonly fact: AedarFact | null
  readonly horizonMinutes: AedarEquipmentHorizon
  readonly selectedModes: readonly AedarRampMode[]
  readonly evidence: Pick<AedarEquipmentExplorerEvidence,
    | 'distributionStatistics'
    | 'distributionAxisTitle'
    | 'distributionYAxisTitle'
    | 'distributionFigureTitle'
    | 'distributionDescription'
    | 'distributionUnavailableDescription'
    | 'distributionValueUnit'>
  readonly comparison?: AedarComparisonEvidence | null
  readonly referenceFact?: AedarFact | null
  readonly comparisonLabel?: string | null
  readonly comparisonVisible?: boolean
  readonly comparisonLayerSupported?: boolean
}

/**
 * The exact resolver the distribution figure draws with: group cells through
 * the shared group resolver, direct references through the owner's coverage and
 * source-clock guards. Never a second approximation.
 */
export function aedarQuantileReferenceValue(
  input: Pick<AedarQuantileReadingInput, 'fact' | 'horizonMinutes' | 'comparison' | 'referenceFact'>,
  mode: AedarRampMode,
  statisticKey: string,
): number | null {
  const measurementKey = `count_${input.horizonMinutes}_${mode}_${statisticKey}`
  if (input.comparison) return aedarGroupValue(input.comparison, input.fact, measurementKey)
  const reference = input.referenceFact
  return reference && input.fact && reference.coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const)
      .every((key) => reference[key] === input.fact![key])
    ? readAedarCountMeasure(reference, input.horizonMinutes, mode, statisticKey) : null
}

export function aedarQuantileServedRank(
  input: Pick<AedarQuantileReadingInput, 'fact' | 'horizonMinutes' | 'comparison'>,
  mode: AedarRampMode,
  statisticKey: string,
): ComparisonRank | null {
  if (!input.comparison) return null
  return aedarComparisonRank(aedarComparisonCell(
    input.comparison,
    input.fact?.typequ,
    `count_${input.horizonMinutes}_${mode}_${statisticKey}`,
  ))
}

export interface AedarQuantileReading {
  readonly figure: CahierGroupedVerticalBarFigureData
  /** Served reference exists for every acquired mode at this figure's horizon/stats. */
  readonly referenceAvailable: boolean
  /** The effective selected modes carry a served reference. */
  readonly visibleReferenceAvailable: boolean
  readonly comparisonEnabled: boolean
  /** Keys the chart and its table/accessibility must hide. */
  readonly hiddenSeriesKeys: readonly string[]
}

export function aedarQuantileReading(input: AedarQuantileReadingInput): AedarQuantileReading {
  const { evidence, fact, horizonMinutes, selectedModes } = input
  const comparisonEnabled = input.comparisonLayerSupported === true
    || Boolean(input.comparisonLabel) || Boolean(input.comparison)
  const referenceAvailable = AEDAR_RAMP_MODES.some((mode) =>
    evidence.distributionStatistics.some((statistic) =>
      aedarQuantileReferenceValue(input, mode, statistic.key) !== null))
  const visibleReferenceAvailable = selectedModes.some((mode) =>
    evidence.distributionStatistics.some((statistic) =>
      aedarQuantileReferenceValue(input, mode, statistic.key) !== null))
  const hiddenSeriesKeys = input.comparisonVisible === false
    ? selectedModes.map((mode) => `${mode}-reference`)
    : []
  const comparisonAdvertised = comparisonEnabled && input.comparisonVisible !== false
  const formatEstablishmentCount = (value: number): string =>
    `${formatNumber(value)} ${evidence.distributionValueUnit}${value > 1 ? 's' : ''}`

  const figure: CahierGroupedVerticalBarFigureData = {
    categories: evidence.distributionStatistics.map((statistic) => ({
      key: statistic.key,
      label: statistic.label,
      axisLabel: statistic.axisLabel,
    })),
    series: selectedModes.flatMap((mode) => [{
      key: mode,
      label: AEDAR_RAMP_MODE_LABELS[mode],
      color: AEDAR_TIME_MODE_COLORS[mode] ?? 'var(--cahier-theme-strong)',
      icon: AEDAR_TIME_MODE_ICONS[mode],
      values: evidence.distributionStatistics.map((statistic) =>
        readAedarCountMeasure(fact, horizonMinutes, mode, statistic.key)),
    }, ...(comparisonEnabled ? [{
      key: `${mode}-reference`,
      label: `Groupe comparé : ${AEDAR_RAMP_MODE_LABELS[mode]}`,
      color: `color-mix(in srgb, ${AEDAR_TIME_MODE_COLORS[mode]} 45%, transparent)`,
      values: evidence.distributionStatistics.map((statistic) =>
        aedarQuantileReferenceValue(input, mode, statistic.key)),
      comparisonFor: mode,
      ranks: evidence.distributionStatistics.map((statistic) =>
        aedarQuantileServedRank(input, mode, statistic.key)),
    }] : [])]),
    xAxisTitle: evidence.distributionAxisTitle,
    yAxisTitle: evidence.distributionYAxisTitle,
    description: fact
      ? `${fact.typequ_label} (${fact.typequ}). ${evidence.distributionFigureTitle} à ${horizonMinutes} minutes. ${evidence.distributionDescription}${comparisonAdvertised ? ` Groupe comparé : ${input.comparisonLabel ?? AEDAR_UNAVAILABLE_LABEL}.` : ''}`
      : evidence.distributionUnavailableDescription,
    formatValue: formatNumber,
    formatAriaValue: formatEstablishmentCount,
    formatAxisTick: formatNumber,
  }

  return {
    figure,
    referenceAvailable,
    visibleReferenceAvailable,
    comparisonEnabled,
    hiddenSeriesKeys,
  }
}

/* ------------------------------------------------------------------ *
 * Explorer volume ramp (selected TYPEQU, acquired detail / reference)
 * ------------------------------------------------------------------ */

export interface AedarExplorerReadingInput {
  readonly fact: AedarFact | null
  readonly baseFact: AedarFact | null
  readonly comparison: AedarComparisonEvidence | null
  readonly referenceDetail: AedarFact | null
  readonly comparisonRequestPresent: boolean
  readonly comparisonLabel: string | null
  readonly comparisonLayerSupported: boolean
  readonly volumeYAxisTitle: string
}

/** The exact group resolver the volume ramp draws with. */
export function aedarExplorerGroupValue(
  input: Pick<AedarExplorerReadingInput, 'baseFact' | 'comparison' | 'referenceDetail' | 'comparisonRequestPresent'>,
  horizon: AedarEquipmentHorizon,
  mode: AedarRampMode,
  statistic: string,
): number | null {
  if (input.comparisonRequestPresent) {
    return aedarGroupValue(input.comparison, input.baseFact, `count_${horizon}_${mode}_${statistic}`)
  }
  const reference = input.referenceDetail
  const focal = input.baseFact
  return reference && focal && reference.coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const)
      .every((key) => reference[key] === focal[key])
    ? readAedarCountMeasure(reference, horizon, mode, statistic) : null
}

export function aedarExplorerServedReference(
  input: AedarExplorerReadingInput,
  modes: readonly AedarRampMode[],
): boolean {
  return AEDAR_EQUIPMENT_BUCKET_HORIZONS.some((horizon) =>
    modes.some((mode) => aedarExplorerGroupValue(input, horizon, mode, 'mean') !== null))
}

export function aedarExplorerVolumeRamp(input: AedarExplorerReadingInput): TimeRampFigureData {
  const series = AEDAR_RAMP_MODES.map((mode) => ({
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    points: AEDAR_EQUIPMENT_BUCKET_HORIZONS.map((horizon) => {
      const referenceValue = aedarExplorerGroupValue(input, horizon, mode, 'mean')
      return {
        xValue: horizon,
        xLabel: `${horizon} min`,
        value: readAedarCountMeasure(input.fact, horizon, mode, 'mean'),
        referenceValue,
        referenceRank: referenceValue === null
          ? null
          : aedarComparisonRank(aedarComparisonCell(
            input.comparison, input.baseFact?.typequ, `count_${horizon}_${mode}_mean`)),
      }
    }),
  }))
  const values = series.flatMap((item) => item.points.map((point) => point.value))
  const availability: FactAvailability = values.every((value) => value !== null)
    ? 'complete'
    : values.some((value) => value !== null) ? 'incomplete' : 'absent'
  return {
    availability,
    xAxis: { label: 'Temps de trajet', unit: 'minutes' },
    yAxis: { label: input.volumeYAxisTitle, unit: '' },
    series,
    provenance: null,
    comparisonLabel: input.comparisonLabel,
    comparisonLayerSupported: input.comparisonLayerSupported,
  }
}

/* ------------------------------------------------------------------ *
 * Car-overview scalars and served ranks
 * ------------------------------------------------------------------ */

export function aedarOverviewScalarRank(scalar: AedarCarAccessOverviewScalar): ComparisonRank | null {
  if (typeof scalar.rank !== 'number' || typeof scalar.rankSize !== 'number') return null
  const rank = { position: scalar.rank, size: scalar.rankSize, ties: scalar.rankTies ?? null }
  return formatServedRank(rank) ? rank : null
}

export function aedarOverviewScalarRankAria(scalar: AedarCarAccessOverviewScalar): string | null {
  const rank = aedarOverviewScalarRank(scalar)
  return rank ? formatServedRankAria(rank) : null
}

export function aedarOverviewScalarServedRank(scalar: AedarCarAccessOverviewScalar) {
  const rank = aedarOverviewScalarRank(scalar)
  if (!rank || !scalar.rankDirection) return null
  return {
    ...rank,
    direction: scalar.rankDirection === 'high' ? 'plus-est-mieux' as const : 'moins-est-mieux' as const,
    key: scalar.key,
  }
}

export function aedarOverviewScalarAria(
  evidence: Pick<AedarCarAccessOverviewEvidence, 'scalarFigureTitle'>,
  scalar: AedarCarAccessOverviewScalar,
  comparisonEligible: boolean,
): string {
  const value = scalar.value === null
    ? 'indisponible'
    : `${formatNumber(scalar.value)} ${scalar.unit}`
  const reference = comparisonEligible && scalar.reference
    ? ` ${scalar.reference.label} : ${formatNumber(scalar.reference.value)} ${scalar.reference.unit}.`
    : comparisonEligible && scalar.comparisonUnavailableLabel
      ? ` ${scalar.comparisonAccessibleLabel ?? 'Moyenne du groupe comparé'} indisponible.`
      : ''
  const rank = aedarOverviewScalarRankAria(scalar)
  return `${scalar.label} : ${value}. ${evidence.scalarFigureTitle}.${reference}${rank ? ` Rang ${rank}.` : ''}`
}

/* ------------------------------------------------------------------ *
 * Equipment waffle (current horizon)
 * ------------------------------------------------------------------ */

export interface AedarWaffleReading {
  readonly profile: AedarEquipmentBuckets | null
  readonly summary: string
}

export function aedarWaffleReading(options: {
  facts: readonly AedarFact[]
  threshold: number
  horizonMinutes: AedarEquipmentHorizon
}): AedarWaffleReading {
  let profile: AedarEquipmentBuckets | null = null
  try {
    profile = classifyAedarEquipmentTypes(options.facts, {
      horizonMinutes: options.horizonMinutes,
      threshold: options.threshold,
    })
  } catch {
    profile = null
  }
  if (profile?.status !== 'complete') {
    return {
      profile,
      summary: 'Répartition indisponible : les données AEDAR sont incomplètes ou incohérentes.',
    }
  }
  return {
    profile,
    summary: `Répartition des ${profile.buckets.reduce((total, bucket) => total + bucket.count, 0)} types d’équipements à ${options.horizonMinutes} minutes. ${profile.buckets.map((item) => `${item.label} : ${item.count}`).join('. ')}.`,
  }
}

export function aedarWaffleShareValue(
  facts: readonly AedarFact[],
  horizonMinutes: AedarEquipmentHorizon,
  typequ: string,
  mode: AedarEquipmentModeKey,
): number | null {
  const fact = facts.find((item) => item.typequ === typequ)
  const value = fact?.measures[aedarEquipmentShareMeasureKey(horizonMinutes, mode)]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const WAFFLE_PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

/** The dialog table cell and the export cell share this formatter. */
export function aedarWaffleShareLabel(
  facts: readonly AedarFact[],
  horizonMinutes: AedarEquipmentHorizon,
  typequ: string,
  mode: AedarEquipmentModeKey,
): string {
  const value = aedarWaffleShareValue(facts, horizonMinutes, typequ, mode)
  return value === null ? '—' : WAFFLE_PERCENT.format(value)
}

export function aedarWaffleModeRows(): readonly { key: AedarEquipmentModeKey; label: string }[] {
  return AEDAR_EQUIPMENT_MODES.map(({ key, tableLabel }) => ({ key, label: tableLabel }))
}
