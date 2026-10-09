<script setup lang="ts">
import { computed } from 'vue'
import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureAxisTick } from '@/fiche/cahierFigureGrammaire'
import type { ContentFact } from '@/fiche/content/themeContent'
import type { TrajectoryMetadata } from '@/payload/types'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'

const props = defineProps<{ offer: ContentFact | null; trajectory: readonly ContentFact[]; metadata: TrajectoryMetadata | null }>()
const geometry = CAHIER_FIGURE_GEOMETRY
const details = computed(() => props.metadata?.ticks?.map(tick => tick.detail)
  ?? [...new Set(props.trajectory.map(item => item.fact.detail).filter((item): item is string => item !== null))])
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
const markerPoint = computed(() => props.metadata?.marker
  ? props.trajectory.find(item => item.fact.detail === props.metadata?.marker?.detail && item.fact.value !== null)
  : undefined)
const marker = computed(() => props.metadata?.marker)
const seriesDescription = computed(() => {
  const declaredEndpoints = props.metadata?.endpoints ?? []
  const points = declaredEndpoints.flatMap((detail) => {
    const item = props.trajectory.find(candidate => candidate.fact.detail === detail)
    if (!item || item.fact.value === null) return []
    const tickLabel = props.metadata?.ticks?.find(tick => tick.detail === detail)?.label ?? detail
    const value = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(item.fact.value)
    return [`${tickLabel} : ${value}`]
  })
  return points.length ? `Territoire — ${props.metadata?.axisLabels?.x ?? 'temps'} / ${props.metadata?.axisLabels?.y ?? 'valeur'} : ${points.join(' ; ')}.` : 'Aucune valeur de trajectoire disponible.'
})
const factsWithRiders = computed(() => props.trajectory.filter((fact) => fact.fact.reason !== null))
function yPosition(value: number): number {
  return geometry.margin.top + (1 - Math.max(0, Math.min(1, value))) * (geometry.height - geometry.margin.top - geometry.margin.bottom)
}
</script>

<template>
  <div class="cahier-figure-frame transit-trajectory">
    <div v-if="offer" class="transit-offer">
      <CahierFigureScalar :value="offer.fact.value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(offer.fact.value)" :label="offer.label" :aria-label="`${offer.label} : ${offer.fact.value ?? 'indisponible'} ${offer.fact.unit}`" />
      <p v-if="offer.fact.reason" class="transit-rider">{{ offer.fact.reason }}</p>
    </div>
    <figure v-if="trajectory.length && metadata">
      <div class="transit-plot cahier-figure-plot" :style="{ aspectRatio: `${geometry.width} / ${geometry.height}` }">
        <svg :viewBox="`0 0 ${geometry.width} ${geometry.height}`" role="img" :aria-label="`${metadata.axisLabels?.x ?? ''} — ${metadata.axisLabels?.y ?? ''}. ${seriesDescription}${markerPoint && metadata.marker ? ` Repère : ${metadata.marker.label}.` : ''}`">
          <CahierFigureAxes :geometry="geometry" :x-ticks="ticks" :y-ticks="yTicks" />
          <path v-if="seriesPath(trajectory)" class="transit-series transit-series--territory" data-series="territory" :d="seriesPath(trajectory)" />
          <circle v-for="item in trajectory" :key="item.fact.detail ?? item.fact.key" class="transit-point transit-point--territory" data-series="territory" :data-detail="item.fact.detail" :data-value="item.fact.value" :cx="ticks.find(tick => tick.key === item.fact.detail)?.position" :cy="geometry.margin.top + (1 - (item.fact.value ?? 0)) * (geometry.height - geometry.margin.top - geometry.margin.bottom)" r="4" />
          <g v-if="markerPoint && marker" class="transit-marker" :data-detail="marker?.detail" :aria-label="marker?.label">
            <circle class="transit-marker-ring" :cx="ticks.find(tick => tick.key === marker?.detail)?.position" :cy="yPosition(markerPoint.fact.value!)" r="8" />
            <text class="transit-marker-label" :x="(ticks.find(tick => tick.key === marker?.detail)?.position ?? 0) + 10" :y="yPosition(markerPoint.fact.value!) - 9">{{ marker?.label }}</text>
          </g>
        </svg>
        <CahierFigureAxisLabels :geometry="geometry" :x-ticks="ticks" :y-ticks="yTicks" />
        <span class="cahier-figure-axis-title cahier-figure-axis-title--x">{{ metadata.axisLabels?.x }}</span>
        <span class="cahier-figure-axis-title cahier-figure-axis-title--y">{{ metadata.axisLabels?.y }}</span>
      </div>
      <figcaption class="transit-legend"><span class="transit-legend-territory" role="img" aria-label="Série du territoire"><span aria-hidden="true" />Territoire</span></figcaption>
    </figure>
    <p v-else class="transit-unavailable">Trajectoire indisponible.</p>
    <ul v-if="factsWithRiders.length" class="transit-riders">
      <li v-for="fact in factsWithRiders" :key="`${fact.fact.key}:${fact.fact.detail}`"><strong>{{ fact.label }} :</strong> {{ fact.fact.reason }}</li>
    </ul>
  </div>
</template>

<style>
@import "./cahierFigure.css";
</style>
<style scoped>
.transit-trajectory { display: grid; gap: var(--space-5); }
.transit-offer { display: grid; gap: var(--space-2); justify-items: start; }
.transit-rider, .transit-riders { margin: 0; }
.transit-riders { padding-inline-start: 1.25rem; }
.transit-plot { position: relative; width: 100%; }
.transit-plot svg { width: 100%; height: auto; overflow: visible; }
.transit-series { fill: none; stroke-width: 3; }
.transit-series--territory { stroke: var(--cahier-theme); }
.transit-point { stroke-width: 2; fill: var(--cahier-paper); }
.transit-point--territory { stroke: var(--cahier-theme); }
.transit-marker-ring { fill: var(--cahier-paper); stroke: var(--cahier-theme); stroke-width: 3; }
.transit-marker-label { fill: currentColor; font-size: 14px; font-weight: 700; }
.transit-legend { display: flex; gap: var(--space-2); align-items: center; }
.transit-legend-territory { display: inline-flex; align-items: center; gap: var(--space-2); }
.transit-legend-territory { border-top-style: solid; border-color: var(--cahier-theme); }
.transit-unavailable { margin: 0; }
</style>
