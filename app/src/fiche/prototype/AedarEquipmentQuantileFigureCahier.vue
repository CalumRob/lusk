<script setup lang="ts">
import { computed } from 'vue'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { aedarGroupValue } from '@/fiche/content/aedarComparisonClient'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_RAMP_MODE_LABELS, readAedarCountMeasure } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import CahierGroupedVerticalBarChart from './CahierGroupedVerticalBarChart.vue'

const props = defineProps<{
  fact: AedarFact | null
  horizonMinutes: AedarEquipmentHorizon
  selectedModes: readonly AedarRampMode[]
  evidence: AedarEquipmentExplorerEvidence
  comparison?: AedarComparisonEvidence | null
  referenceFact?: AedarFact | null
  comparisonLabel?: string | null
}>()

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

function formatEstablishmentCount(value: number): string {
  return `${formatNumber(value)} établissement${value > 1 ? 's' : ''}`
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
    values: props.evidence.distributionStatistics.map((statistic) =>
      readAedarCountMeasure(props.fact, props.horizonMinutes, mode, statistic.key)),
  }, ...(props.comparisonLabel ? [{
    key: `${mode}-reference`, label: `Groupe comparé : ${AEDAR_RAMP_MODE_LABELS[mode]}`,
    color: `color-mix(in srgb, ${AEDAR_TIME_MODE_COLORS[mode]} 45%, transparent)`,
    values: props.evidence.distributionStatistics.map((statistic) => {
      if (props.comparison) return aedarGroupValue(props.comparison, props.fact, `count_${props.horizonMinutes}_${mode}_${statistic.key}`)
      const reference = props.referenceFact
      return reference && props.fact && reference.coverage_status === 'covered'
        && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const).every((key) => reference[key] === props.fact![key])
        ? readAedarCountMeasure(reference, props.horizonMinutes, mode, statistic.key) : null
    }),
  }] : [])]),
  xAxisTitle: props.evidence.distributionAxisTitle,
  yAxisTitle: props.evidence.distributionYAxisTitle,
  description: props.fact
    ? `${props.fact.typequ_label} (${props.fact.typequ}). ${props.evidence.distributionFigureTitle} à ${props.horizonMinutes} minutes. ${props.evidence.distributionDescription}${props.comparisonLabel ? ` Groupe comparé : ${props.comparisonLabel}.` : ''}`
    : props.evidence.distributionUnavailableDescription,
  formatValue: formatEstablishmentCount,
  formatAxisTick: formatNumber,
}))
</script>

<template>
  <CahierGroupedVerticalBarChart :figure="figure" />
  <p v-if="comparisonLabel" class="aedar-quantile-comparison-note">À droite de chaque paire de barres : Groupe comparé.</p>
</template>

<style scoped>
.aedar-quantile-comparison-note { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); text-align: center; }
</style>
