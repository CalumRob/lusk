<script setup lang="ts">
import { computed } from 'vue'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import { aedarQuantileReading } from './aedarFigureReadings'
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

const reading = computed(() => aedarQuantileReading({
  fact: props.fact,
  horizonMinutes: props.horizonMinutes,
  selectedModes: props.selectedModes,
  evidence: props.evidence,
  comparison: props.comparison,
  referenceFact: props.referenceFact,
  comparisonLabel: props.comparisonLabel,
  comparisonVisible: props.comparisonVisible,
  comparisonLayerSupported: props.comparisonLayerSupported,
}))
const figure = computed(() => reading.value.figure)

// #1021 — this distribution figure publishes the reference it actually draws.
useCahierExportPublication(() => ({
  owner: 'aedar-comparison-layer',
  state: {
    toggle: props.comparisonVisible ?? null,
    referenceAvailable: reading.value.referenceAvailable,
    visibleReferenceAvailable: reading.value.visibleReferenceAvailable,
    displayed: reading.value.comparisonEnabled
      && props.comparisonVisible !== false
      && reading.value.visibleReferenceAvailable,
  },
}), 'distribution')
</script>

<template>
  <CahierGroupedVerticalBarChart :figure="figure" :hidden-series-keys="reading.hiddenSeriesKeys" />
</template>
