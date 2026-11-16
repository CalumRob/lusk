<script setup lang="ts">
import { computed } from 'vue'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { aedarComparisonCell, aedarComparisonRank, aedarGroupValue } from '@/fiche/content/aedarComparisonClient'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import type { ComparisonRank } from '@/fiche/content/territoryFacts'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_RAMP_MODE_LABELS, AEDAR_RAMP_MODES, readAedarCountMeasure } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import { AEDAR_TIME_MODE_ICONS } from './aedarTimeModeIcons'
import CahierGroupedVerticalBarChart from './CahierGroupedVerticalBarChart.vue'
import { useCahierExportPublication } from './cahierExportVenue'

const props = defineProps<{
  fact: AedarFact | null
  horizonMinutes: AedarEquipmentHorizon
  selectedModes: readonly AedarRampMode[]
  evidence: AedarEquipmentExplorerEvidence
  comparison?: AedarComparisonEvidence | null
  referenceFact?: AedarFact | null
  comparisonLabel?: string | null
  comparisonVisible?: boolean
  comparisonLayerSupported?: boolean
}>()

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

/** Accessible reading: the content-declared count noun, spelled out (visible rows stay bare). */
function formatEstablishmentCount(value: number): string {
  const unit = props.evidence.distributionValueUnit
  return `${formatNumber(value)} ${unit}${value > 1 ? 's' : ''}`
}

const measurementKey = (mode: AedarRampMode, statisticKey: string): string =>
  `count_${props.horizonMinutes}_${mode}_${statisticKey}`

/**
 * The exact resolver the reference series below draws with: group cells through
 * the shared group resolver, direct references through the owner's coverage and
 * source-clock guards. Reused by the export publication, never copied.
 */
function referenceValueFor(mode: AedarRampMode, statisticKey: string): number | null {
  if (props.comparison) return aedarGroupValue(props.comparison, props.fact, measurementKey(mode, statisticKey))
  const reference = props.referenceFact
  return reference && props.fact && reference.coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const).every((key) => reference[key] === props.fact![key])
    ? readAedarCountMeasure(reference, props.horizonMinutes, mode, statisticKey) : null
}

const comparisonEnabled = computed(() => props.comparisonLayerSupported === true
  || Boolean(props.comparisonLabel) || Boolean(props.comparison))

/** A hidden comparison is not advertised in the figure's accessible description. */
const comparisonAdvertised = computed(() => comparisonEnabled.value && props.comparisonVisible !== false)

/** Reference availability for every acquired mode, at this figure's horizon/stats. */
const referenceAvailable = computed(() => AEDAR_RAMP_MODES.some((mode) =>
  props.evidence.distributionStatistics.some((statistic) => referenceValueFor(mode, statistic.key) !== null)))
/** Reference availability restricted to the modes the reader actually selected. */
const visibleReferenceAvailable = computed(() => props.selectedModes.some((mode) =>
  props.evidence.distributionStatistics.some((statistic) => referenceValueFor(mode, statistic.key) !== null)))
// #1021 — this distribution figure publishes the reference it actually draws.
useCahierExportPublication(() => ({
  owner: 'aedar-comparison-layer',
  state: {
    toggle: props.comparisonVisible ?? null,
    referenceAvailable: referenceAvailable.value,
    visibleReferenceAvailable: visibleReferenceAvailable.value,
    displayed: comparisonEnabled.value
      && props.comparisonVisible !== false
      && visibleReferenceAvailable.value,
  },
}), 'distribution')

function servedRankFor(mode: AedarRampMode, statisticKey: string): ComparisonRank | null {
  if (!props.comparison) return null
  return aedarComparisonRank(aedarComparisonCell(props.comparison, props.fact?.typequ, measurementKey(mode, statisticKey)))
}

const figure = computed<CahierGroupedVerticalBarFigureData>(() => ({
  categories: props.evidence.distributionStatistics.map((statistic) => ({
    key: statistic.key,
    label: statistic.label,
    axisLabel: statistic.axisLabel,
  })),
  series: props.selectedModes.flatMap((mode) => [{
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    color: AEDAR_TIME_MODE_COLORS[mode] ?? 'var(--cahier-theme-strong)',
    icon: AEDAR_TIME_MODE_ICONS[mode],
    values: props.evidence.distributionStatistics.map((statistic) =>
      readAedarCountMeasure(props.fact, props.horizonMinutes, mode, statistic.key)),
  }, ...(comparisonEnabled.value ? [{
    key: `${mode}-reference`, label: `Groupe comparé : ${AEDAR_RAMP_MODE_LABELS[mode]}`,
    color: `color-mix(in srgb, ${AEDAR_TIME_MODE_COLORS[mode]} 45%, transparent)`,
    values: props.evidence.distributionStatistics.map((statistic) =>
      referenceValueFor(mode, statistic.key)),
    comparisonFor: mode,
    ranks: props.evidence.distributionStatistics.map((statistic) => servedRankFor(mode, statistic.key)),
  }] : [])]),
  xAxisTitle: props.evidence.distributionAxisTitle,
  yAxisTitle: props.evidence.distributionYAxisTitle,
  description: props.fact
    ? `${props.fact.typequ_label} (${props.fact.typequ}). ${props.evidence.distributionFigureTitle} à ${props.horizonMinutes} minutes. ${props.evidence.distributionDescription}${comparisonAdvertised.value ? ` Groupe comparé : ${props.comparisonLabel ?? 'Indisponible'}.` : ''}`
    : props.evidence.distributionUnavailableDescription,
  formatValue: formatNumber,
  formatAriaValue: formatEstablishmentCount,
  formatAxisTick: formatNumber,
}))
</script>

<template>
  <CahierGroupedVerticalBarChart :figure="figure" :hidden-series-keys="comparisonVisible === false ? figure.series.filter((series) => series.key.endsWith('-reference')).map((series) => series.key) : []" />
</template>
