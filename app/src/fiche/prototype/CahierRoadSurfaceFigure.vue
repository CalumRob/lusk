<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { ContentFact, ExplorationTarget, SharingNetworksEvidence } from '@/fiche/content/themeContent'
import { routePourCibleExploration } from '@/fiche/explorationHandoff'
import CahierComparisonNote from './CahierComparisonNote.vue'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierProse from './CahierProse.vue'

const props = defineProps<{
  evidence: SharingNetworksEvidence
  targets: readonly ExplorationTarget[]
}>()

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

function formatFact(fact: ContentFact): string {
  if (fact.fact.value === null) return '—'
  return fact.fact.unit === '%'
    ? `${formatNumber(fact.fact.value * 100)} %`
    : formatNumber(fact.fact.value)
}

function routeFor(fact: ContentFact): RouteLocationRaw | null {
  const target = props.targets.find(
    (candidate) => candidate.key === fact.fact.key && candidate.detail === fact.fact.detail,
  )
  return target ? routePourCibleExploration(target) : null
}

function ariaForFact(fact: ContentFact): string {
  return `${fact.label} : ${formatFact(fact)}`
}
</script>

<template>
  <figure class="road-surface-figure">
    <figcaption class="cahier-figure-title">Emprise routière</figcaption>
    <CahierFigureFrame>
      <CahierFigureScalar
        class="road-surface-scalar"
        :data-indicator="props.evidence.roadSurface.fact.key"
        :value="formatFact(props.evidence.roadSurface)"
        :label="props.evidence.roadSurface.label"
        :show-label="false"
        :aria-label="ariaForFact(props.evidence.roadSurface)"
      >
        <template #reference>
          <CahierComparisonValue
            :fact="props.evidence.roadSurface.fact"
            :maximum-fraction-digits="0"
            :to="routeFor(props.evidence.roadSurface)"
          />
        </template>
      </CahierFigureScalar>

      <CahierComparisonNote :label="props.evidence.comparisonLabel" />
    </CahierFigureFrame>
    <CahierFigureLecture>
      <CahierProse :blocks="props.evidence.roadSurfaceLecture" />
    </CahierFigureLecture>
  </figure>
</template>

<style scoped>
.road-surface-figure {
  margin: 0;
}

.road-surface-scalar :deep(.cahier-figure-scalar-value) {
  color: var(--cahier-default);
}
</style>
