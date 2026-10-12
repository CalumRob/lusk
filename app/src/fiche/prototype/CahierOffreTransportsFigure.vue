<script setup lang="ts">
import { computed } from 'vue'
import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureAxisTick } from '@/fiche/cahierFigureGrammaire'
import type { ComparisonTrajectoryContent, ContentFact } from '@/fiche/content/themeContent'
import type { TrajectoryMetadata } from '@/payload/types'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'

const props = defineProps<{ offer: ContentFact | null; trajectory: readonly ContentFact[];
  comparisonTrajectory?: ComparisonTrajectoryContent | null; metadata: TrajectoryMetadata | null }>()
const geometry = CAHIER_FIGURE_GEOMETRY
const details = computed(() => [...new Set(props.trajectory.map(item => item.fact.detail)
  .filter((item): item is string => item !== null))])
const allSeriesPoints = computed(() => [...props.trajectory,
  ...(props.comparisonTrajectory?.points ?? [])])
function positionFor(detail: string, axisValue?: number): number {
  const left = geometry.margin.left
  const width = geometry.width - left - geometry.margin.right
  if (props.metadata?.axis === 'numeric' && axisValue !== undefined) {
    const numeric = allSeriesPoints.value.flatMap(item => item.fact.axisValue === undefined ? [] : [item.fact.axisValue])
    const min = Math.min(...numeric)
    const max = Math.max(...numeric)
    return left + width * (max === min ? 0 : (axisValue - min) / (max - min))
  }
  const index = details.value.indexOf(detail)
  return left + width * (details.value.length < 2 ? 0 : index / (details.value.length - 1))
}
const ticks = computed((): CahierFigureAxisTick[] => {
  const labels = new Map((props.metadata?.ticks ?? []).map(tick => [tick.detail, tick.label]))
  const displayDetails = props.metadata?.ticks?.map(tick => tick.detail) ?? details.value
  return displayDetails.map((detail) => ({ key: detail, label: labels.get(detail) ?? detail,
    position: positionFor(detail, props.trajectory.find(item => item.fact.detail === detail)?.fact.axisValue) }))
})
const yTicks = computed((): CahierFigureAxisTick[] => {
  const top = geometry.margin.top
  const height = geometry.height - top - geometry.margin.bottom
  return [0, .25, .5, .75, 1].map(value => ({ key: String(value), label: `${value * 100}%`, position: top + height * (1 - value) }))
})
function seriesPath(series: readonly ContentFact[]): string {
  const byDetail = new Map(series.map(item => [item.fact.detail, item.fact.value]))
  const byAxis = new Map(series.map(item => [item.fact.detail, item.fact.axisValue]))
  return details.value.flatMap((detail, index) => {
    const value = byDetail.get(detail)
    if (value === null || value === undefined) return []
    const x = positionFor(detail, byAxis.get(detail ?? '') ?? undefined)
    const y = geometry.margin.top + (1 - Math.max(0, Math.min(1, value))) * (geometry.height - geometry.margin.top - geometry.margin.bottom)
    return [`${index ? 'L' : 'M'}${x},${y}`]
  }).join(' ')
}
const comparisonPath = computed(() => seriesPath(props.comparisonTrajectory?.points ?? []))
const comparisonLabel = computed(() => {
  const comparison = props.comparisonTrajectory
  if (!comparison) return ''
  const statistic = comparison.statistic === 'mean' ? 'Moyenne' : comparison.statistic
  return `${statistic} · ${comparison.scope.label} · ${comparison.eligibleCount}`
})
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
  const comparison = props.comparisonTrajectory
  const comparisonEndpoints = comparison ? declaredEndpoints.flatMap((detail) => {
    const item = comparison.points.find(candidate => candidate.fact.detail === detail)
    if (!item || item.fact.value === null) return []
    const tickLabel = props.metadata?.ticks?.find(tick => tick.detail === detail)?.label ?? detail
    return [`${tickLabel} : ${new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(item.fact.value)}`]
  }) : []
  const comparisonDescription = comparisonEndpoints.length
    ? ` ${comparisonLabel.value} : ${comparisonEndpoints.join(' ; ')}.` : ''
  return (points.length ? `Territoire — ${props.metadata?.axisLabels?.x ?? 'temps'} / ${props.metadata?.axisLabels?.y ?? 'valeur'} : ${points.join(' ; ')}.` : 'Aucune valeur de trajectoire disponible.') + comparisonDescription
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
          <circle v-for="item in trajectory" :key="item.fact.detail ?? item.fact.key" class="transit-point transit-point--territory" data-series="territory" :data-detail="item.fact.detail" :data-value="item.fact.value" :cx="positionFor(item.fact.detail ?? '', item.fact.axisValue)" :cy="geometry.margin.top + (1 - (item.fact.value ?? 0)) * (geometry.height - geometry.margin.top - geometry.margin.bottom)" r="4" />
          <path v-if="comparisonPath" class="transit-series transit-series--comparison" data-series="comparison" :d="comparisonPath" />
          <rect v-for="item in comparisonTrajectory?.points ?? []" :key="item.fact.detail ?? item.fact.key" class="transit-point transit-point--comparison" data-series="comparison" :data-detail="item.fact.detail" :data-value="item.fact.value" :x="positionFor(item.fact.detail ?? '', item.fact.axisValue) - 3.5" :y="geometry.margin.top + (1 - (item.fact.value ?? 0)) * (geometry.height - geometry.margin.top - geometry.margin.bottom) - 3.5" width="7" height="7" />
          <g v-if="markerPoint && marker" class="transit-marker" :data-detail="marker?.detail" :aria-label="marker?.label">
            <circle class="transit-marker-ring" :cx="ticks.find(tick => tick.key === marker?.detail)?.position" :cy="yPosition(markerPoint.fact.value!)" r="8" />
            <text class="transit-marker-label" :x="(ticks.find(tick => tick.key === marker?.detail)?.position ?? 0) + 10" :y="yPosition(markerPoint.fact.value!) - 9">{{ marker?.label }}</text>
          </g>
        </svg>
        <CahierFigureAxisLabels :geometry="geometry" :x-ticks="ticks" :y-ticks="yTicks" />
        <span class="cahier-figure-axis-title cahier-figure-axis-title--x">{{ metadata.axisLabels?.x }}</span>
        <span class="cahier-figure-axis-title cahier-figure-axis-title--y">{{ metadata.axisLabels?.y }}</span>
      </div>
      <figcaption class="transit-legend">
        <span class="transit-legend-territory" role="img" aria-label="Série du territoire"><span aria-hidden="true" />Territoire</span>
        <span v-if="comparisonTrajectory" class="transit-legend-comparison" role="img" :aria-label="comparisonLabel"><span aria-hidden="true" />{{ comparisonLabel }}</span>
      </figcaption>
    </figure>
    <p v-else class="transit-unavailable">Trajectoire indisponible.</p>
    <ul v-if="factsWithRiders.length" class="transit-riders">
      <li v-for="fact in factsWithRiders" :key="`${fact.fact.key}:${fact.fact.detail}`"><strong>{{ fact.label }} :</strong> {{ fact.fact.reason }}</li>
    </ul>
  </div>
</template>

<style src="./cahierFigure.css"></style>
<style scoped>
.transit-trajectory { display: grid; gap: var(--space-5); }
.transit-offer { display: grid; gap: var(--space-2); justify-items: start; }
.transit-rider, .transit-riders { margin: 0; }
.transit-riders { padding-inline-start: 1.25rem; }
.transit-plot { position: relative; width: 100%; }
.transit-plot svg { width: 100%; height: auto; overflow: visible; }
.transit-series { fill: none; stroke-width: 3; }
.transit-series--territory { stroke: var(--cahier-theme); }
.transit-series--comparison { stroke: currentColor; stroke-dasharray: 7 4; stroke-width: 2; }
.transit-point { stroke-width: 2; fill: var(--cahier-paper); }
.transit-point--territory { stroke: var(--cahier-theme); }
.transit-point--comparison { fill: var(--cahier-paper); stroke: currentColor; stroke-width: 1.5; }
.transit-marker-ring { fill: var(--cahier-paper); stroke: var(--cahier-theme); stroke-width: 3; }
.transit-marker-label { fill: currentColor; font-size: 14px; font-weight: 700; }
.transit-legend { display: flex; gap: var(--space-2); align-items: center; }
.transit-legend-territory { display: inline-flex; align-items: center; gap: var(--space-2); }
.transit-legend-territory { border-top-style: solid; border-color: var(--cahier-theme); }
.transit-legend-comparison { display: inline-flex; align-items: center; gap: var(--space-2); }
.transit-legend-comparison > span { width: 1.5rem; border-top: 2px dashed currentColor; }
.transit-unavailable { margin: 0; }
</style>
