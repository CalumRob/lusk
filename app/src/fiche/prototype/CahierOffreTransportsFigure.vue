<script setup lang="ts">
import { computed } from 'vue'
import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureAxisTick } from '@/fiche/cahierFigureGrammaire'
import type { ContentFact } from '@/fiche/content/themeContent'
import type { TrajectoryMetadata } from '@/payload/types'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'

const props = defineProps<{ offer: ContentFact; trajectory: readonly ContentFact[]; reference: readonly ContentFact[]; metadata: TrajectoryMetadata | null }>()
const geometry = CAHIER_FIGURE_GEOMETRY
const details = computed(() => props.metadata?.ticks?.map(tick => tick.detail)
  ?? [...new Set([...props.trajectory, ...props.reference].map(item => item.fact.detail).filter((item): item is string => item !== null))])
const ticks = computed((): CahierFigureAxisTick[] => {
  const labels = new Map((props.metadata?.ticks ?? []).map(tick => [tick.detail, tick.label]))
  const left = geometry.margin.left
  const width = geometry.width - left - geometry.margin.right
  return details.value.map((detail) => {
    const index = details.value.indexOf(detail)
    return { key: detail, label: labels.get(detail) ?? detail, position: left + width * (details.value.length < 2 ? 0 : index / (details.value.length - 1)) }
  })
})
const yTicks = computed((): CahierFigureAxisTick[] => {
  const top = geometry.margin.top
  const height = geometry.height - top - geometry.margin.bottom
  return [0, .25, .5, .75, 1].map(value => ({ key: String(value), label: `${value * 100}%`, position: top + height * (1 - value) }))
})
function seriesPath(series: readonly ContentFact[]): string {
  const byDetail = new Map(series.map(item => [item.fact.detail, item.fact.value]))
  return details.value.flatMap((detail, index) => {
    const value = byDetail.get(detail)
    if (value === null || value === undefined) return []
    const x = ticks.value[index]?.position ?? 0
    const y = geometry.margin.top + (1 - Math.max(0, Math.min(1, value))) * (geometry.height - geometry.margin.top - geometry.margin.bottom)
    return [`${index ? 'L' : 'M'}${x},${y}`]
  }).join(' ')
}
const plotPoints = computed(() => [
  ...props.trajectory.map(item => ({ item, series: 'territory' })),
  ...props.reference.map(item => ({ item, series: 'reference' })),
])
</script>

<template>
  <div class="cahier-figure-frame transit-trajectory">
    <CahierFigureScalar :value="offer.fact.value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(offer.fact.value)" :label="offer.label" :aria-label="`${offer.label} : ${offer.fact.value ?? 'indisponible'} ${offer.fact.unit}`" />
    <figure v-if="trajectory.length && metadata">
      <div class="transit-plot cahier-figure-plot" :style="{ aspectRatio: `${geometry.width} / ${geometry.height}` }">
        <svg :viewBox="`0 0 ${geometry.width} ${geometry.height}`" role="img" :aria-label="`${metadata.axisLabels?.x ?? ''} — ${metadata.axisLabels?.y ?? ''}. ${metadata.reference?.label ?? ''}`">
          <CahierFigureAxes :geometry="geometry" :x-ticks="ticks" :y-ticks="yTicks" />
          <path v-if="seriesPath(reference)" class="transit-series transit-series--reference" data-series="reference" :data-label="metadata.reference?.label" :d="seriesPath(reference)" />
          <path v-if="seriesPath(trajectory)" class="transit-series transit-series--territory" data-series="territory" :d="seriesPath(trajectory)" />
          <circle v-for="point in plotPoints" :key="`${point.series}:${point.item.fact.detail}`" class="transit-point" :class="`transit-point--${point.series}`" :data-series="point.series" :data-detail="point.item.fact.detail" :data-value="point.item.fact.value" :cx="ticks.find(tick => tick.key === point.item.fact.detail)?.position" :cy="geometry.margin.top + (1 - (point.item.fact.value ?? 0)) * (geometry.height - geometry.margin.top - geometry.margin.bottom)" r="4" />
        </svg>
        <CahierFigureAxisLabels :geometry="geometry" :x-ticks="ticks" :y-ticks="yTicks" />
        <span class="cahier-figure-axis-title cahier-figure-axis-title--x">{{ metadata.axisLabels?.x }}</span>
        <span class="cahier-figure-axis-title cahier-figure-axis-title--y">{{ metadata.axisLabels?.y }}</span>
      </div>
      <figcaption class="transit-legend"><span class="transit-legend-mark" />{{ metadata.reference?.label }} <span class="transit-legend-territory" />Territoire</figcaption>
    </figure>
    <p v-else class="transit-unavailable">Trajectoire et référence indisponibles.</p>
  </div>
</template>

<style src="./cahierFigure.css"></style>
<style scoped>
.transit-trajectory { display: grid; gap: var(--space-5); }
.transit-plot { position: relative; width: 100%; }
.transit-plot svg { width: 100%; height: auto; overflow: visible; }
.transit-series { fill: none; stroke-width: 3; }
.transit-series--territory { stroke: var(--cahier-theme); }
.transit-series--reference { stroke: var(--cahier-region-emphasis); stroke-dasharray: 7 5; }
.transit-point { stroke-width: 2; fill: var(--cahier-paper); }
.transit-point--territory { stroke: var(--cahier-theme); }
.transit-point--reference { stroke: var(--cahier-region-emphasis); }
.transit-legend { display: flex; gap: var(--space-2); align-items: center; }
.transit-legend-mark, .transit-legend-territory { width: 1.5rem; border-top: 3px dashed var(--cahier-region-emphasis); }
.transit-legend-territory { border-top-style: solid; border-color: var(--cahier-theme); }
.transit-unavailable { margin: 0; }
</style>
