<script setup lang="ts">
/**
 * « Visiter la Bretagne » — the cumulative raccordement curve of Mobilité
 * page 3 (#955). Built on the shared Cahier figure grammar, never on the
 * protected AEDAR ramp. The reference is the active header comparison mean;
 * there is no named-Brittany fallback and no second graph for the scalar.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureGeometry,
  CahierFigureTooltipAnchor,
  CahierTooltipComparison,
  CahierTooltipRow,
  FigureLegendEntry,
} from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'
import ComparisonUnavailableCue from '@/components/fiche/ComparisonUnavailableCue.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteRaccordementEvidence
  comparison: ComparisonState
}>()

const BASE_FIGURE_GEOMETRY = {
  width: 640,
  height: 330,
  margin: { top: 30, right: 24, bottom: 84, left: 68 },
} as const satisfies CahierFigureGeometry

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1] as const
const UNAVAILABLE_LABEL = 'Indisponible'

const comparisonVisible = ref(true)
const plotElement = ref<HTMLElement | null>(null)
const hoveredTickKey = ref<string | null>(null)
const pinnedTickKey = ref<string | null>(null)
const selectedTickKey = computed(() => pinnedTickKey.value ?? hoveredTickKey.value)

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function percentValue(value: number): number {
  return Math.max(0, Math.min(100, value * 100))
}

function visiblePercent(value: number | null): string {
  return value === null ? UNAVAILABLE_LABEL : formatNumber(percentValue(value))
}

function ariaPercent(value: number | null, unit: string): string {
  return value === null ? UNAVAILABLE_LABEL : `${formatNumber(percentValue(value))} ${unit}`
}

function numericAxisValue(fact: NumericFact, fallback: number): number {
  if (typeof fact.axisValue === 'number' && Number.isFinite(fact.axisValue)) return fact.axisValue
  const declared = fact.detail?.match(/^t(\d+)$/u)
  return declared ? Number(declared[1]) : fallback
}

function axisValueForDetail(detail: string): number | null {
  const index = props.figure.points.findIndex((point) => point.fact.detail === detail)
  if (index >= 0) return numericAxisValue(props.figure.points[index]!.fact, index)
  const declared = detail.match(/^t(\d+)$/u)
  return declared ? Number(declared[1]) : null
}

const axisDomain = computed(() => {
  const values = props.figure.points
    .map((point, index) => numericAxisValue(point.fact, index))
    .filter((value) => Number.isFinite(value))
  const comparisonValues = (props.figure.comparison?.points ?? [])
    .map((point, index) => numericAxisValue(point.fact, index))
    .filter((value) => Number.isFinite(value))
  const all = [...values, ...comparisonValues]
  if (!all.length) return { minimum: 0, maximum: 1 }
  const minimum = Math.min(...all)
  const maximum = Math.max(...all)
  return { minimum, maximum: maximum === minimum ? minimum + 1 : maximum }
})

const yTickLabels = computed(() => Y_TICKS.map((value) => `${value * 100} %`))
const geometry = useMeasuredCahierFigureGeometry(plotElement, yTickLabels, BASE_FIGURE_GEOMETRY)
const plotWidth = computed(() => geometry.value.width - geometry.value.margin.left - geometry.value.margin.right)
const plotHeight = computed(() => geometry.value.height - geometry.value.margin.top - geometry.value.margin.bottom)
const plotBottom = computed(() => geometry.value.margin.top + plotHeight.value)

function xForAxis(value: number): number {
  const { minimum, maximum } = axisDomain.value
  const ratio = (value - minimum) / (maximum - minimum)
  return geometry.value.margin.left + ratio * plotWidth.value
}

function yFor(value: number): number {
  return geometry.value.margin.top + (1 - Math.max(0, Math.min(1, value))) * plotHeight.value
}

function seriesPath(points: readonly { fact: NumericFact }[]): string {
  let started = false
  return points.map((point, index) => {
    const value = point.fact.value
    if (value === null || !Number.isFinite(value)) {
      started = false
      return ''
    }
    const x = xForAxis(numericAxisValue(point.fact, index))
    const y = yFor(value)
    const command = `${started ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
    started = true
    return command
  }).filter(Boolean).join(' ')
}

const territoryPath = computed(() => seriesPath(props.figure.points))
const comparisonPath = computed(() => seriesPath(props.figure.comparison?.points ?? []))

const declaredTicks = computed(() => props.figure.trajectory?.ticks ?? [])
const xTicks = computed<readonly CahierFigureAxisTick[]>(() => declaredTicks.value.flatMap((tick) => {
  const axisValue = axisValueForDetail(tick.detail)
  return axisValue === null ? [] : [{
    key: tick.detail,
    label: tick.label,
    position: xForAxis(axisValue),
    className: tick.mobile
      ? 'mobilite-raccordement-curve__tick--mobile'
      : 'mobilite-raccordement-curve__tick--desktop',
  }]
}))
const yTicks = computed<readonly CahierFigureAxisTick[]>(() => Y_TICKS.map((value) => ({
  key: value,
  label: `${value * 100} %`,
  position: yFor(value),
})))

const marker = computed(() => props.figure.trajectory?.marker ?? null)
const markerAxisValue = computed(() => marker.value ? axisValueForDetail(marker.value.detail) : null)
const markerPoint = computed(() => {
  if (!marker.value) return null
  return props.figure.points.find((point) => point.fact.detail === marker.value!.detail) ?? null
})
const markerX = computed(() => markerAxisValue.value === null ? null : xForAxis(markerAxisValue.value))
const markerY = computed(() => markerPoint.value?.fact.value == null
  ? plotBottom.value
  : yFor(markerPoint.value.fact.value))

const comparisonAvailable = computed(() =>
  props.comparison.status === 'ready' && props.figure.comparison !== null,
)
const showComparison = computed(() => comparisonAvailable.value && comparisonVisible.value)

const comparisonDetail = computed(() => {
  if (!props.figure.comparison) return null
  const scope = props.figure.comparison.scope.label
    ?? props.figure.comparisonLabel?.replace(/^(?:Moyenne|Médiane) des /u, '')
    ?? 'groupe comparé'
  return {
    statistic: props.figure.comparison.statistic === 'mean' ? 'Moyenne' : 'Médiane',
    label: scope,
  }
})

function pointAt(detail: string, points: readonly { fact: NumericFact }[]): NumericFact | null {
  return points.find((point) => point.fact.detail === detail)?.fact ?? null
}

function tickAriaValue(detail: string, points: readonly { fact: NumericFact }[], unit: string): string {
  return ariaPercent(pointAt(detail, points)?.value ?? null, unit)
}

const curveUnit = computed(() => props.figure.points[0]?.fact.unit ?? '%')

function comparisonRankForTick(detail: string) {
  if (!marker.value || marker.value.detail !== detail) return null
  return props.figure.markerValue?.fact.comparison?.rank ?? null
}

function comparisonTickAria(detail: string): string {
  if (!props.figure.comparison || !showComparison.value) return ''
  return tickAriaValue(detail, props.figure.comparison.points, curveUnit.value)
}

const accessibleLabel = computed(() => {
  const readings = xTicks.value
    .map((tick) => `${tick.label} : ${tickAriaValue(String(tick.key), props.figure.points, curveUnit.value)}`)
    .join(' ; ')
  const comparisonReadings = showComparison.value && props.figure.comparison
    ? xTicks.value
      .map((tick) => `${tick.label} : ${tickAriaValue(String(tick.key), props.figure.comparison!.points, curveUnit.value)}`)
      .join(' ; ')
    : ''
  const markerReading = marker.value ? ` Repère : ${marker.value.label}.` : ''
  const comparisonReading = comparisonReadings && comparisonDetail.value
    ? ` ${GROUPE_COMPARE_LABEL} — ${comparisonDetail.value.statistic} des ${comparisonDetail.value.label} : ${comparisonReadings}.`
    : ''
  return `${props.figure.figureTitle}. Courbe cumulative de la population bretonne joignable selon le temps de trajet. ` +
    `Axe horizontal : ${props.figure.trajectory?.axisLabels?.x ?? 'temps de trajet'}. ` +
    `Axe vertical : ${props.figure.trajectory?.axisLabels?.y ?? 'population joignable (%)'}. ` +
    `Territoire : ${readings}.${comparisonReading}${markerReading}`
})

const selectedTick = computed(() => xTicks.value.find((tick) => String(tick.key) === selectedTickKey.value) ?? null)
const selectedTickTitle = computed(() => selectedTick.value?.label ?? '')

function tickAriaLabel(tick: CahierFigureAxisTick): string {
  const label = marker.value && String(tick.key) === marker.value.detail
    ? marker.value.label
    : tick.label ?? String(tick.key)
  return `${label} — Territoire : ${tickAriaValue(String(tick.key), props.figure.points, curveUnit.value)}${showComparison.value && props.figure.comparison ? ` ; ${GROUPE_COMPARE_LABEL} : ${comparisonTickAria(String(tick.key))}` : ''}`
}

function tooltipRows(detail: string): readonly CahierTooltipRow[] {
  const unit = curveUnit.value
  const focal = pointAt(detail, props.figure.points)
  let comparison: CahierTooltipComparison | undefined
  if (showComparison.value && props.figure.comparison) {
    const group = pointAt(detail, props.figure.comparison.points)
    const rank = comparisonRankForTick(detail)
    const rankText = formatServedRank(rank)
    const rankAria = formatServedRankAria(rank)
    comparison = {
      value: visiblePercent(group?.value ?? null),
      rank: rankText,
      rankAria,
      ariaLabel: `${GROUPE_COMPARE_LABEL} : ${ariaPercent(group?.value ?? null, unit)} (${comparisonDetail.value?.statistic ?? 'Moyenne'} des ${comparisonDetail.value?.label ?? 'groupe comparé'})${rankAria ? `. Rang ${rankAria}` : ''}`,
    }
  }
  return [{
    label: 'Territoire',
    value: visiblePercent(focal?.value ?? null),
    tone: 't',
    marker: 'dot',
    markerColor: 'var(--brand-500)',
    ariaLabel: `Territoire : ${ariaPercent(focal?.value ?? null, unit)}`,
    comparison,
  }]
}

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (!selectedTick.value) return undefined
  const detail = String(selectedTick.value.key)
  const focal = pointAt(detail, props.figure.points)
  const group = props.figure.comparison ? pointAt(detail, props.figure.comparison.points) : null
  const highest = Math.max(focal?.value ?? 0, group?.value ?? 0)
  const renderedWidth = plotElement.value?.getBoundingClientRect().width ?? 0
  const tooltipWidth = renderedWidth > 0
    ? Math.min(320, Math.max(0, window.innerWidth - 32), Math.max(0, renderedWidth - 16))
    : 0
  const half = renderedWidth > 0 ? tooltipWidth / 2 / renderedWidth : 0.5
  const xPercent = selectedTick.value.position / geometry.value.width
  const clampedX = Math.max(half, Math.min(1 - half, xPercent))
  return {
    x: `${clampedX * 100}%`,
    y: `${Math.max(0.14, Math.min(0.84, yFor(highest) / geometry.value.height)) * 100}%`,
  }
})

function tickHitboxStyle(tick: CahierFigureAxisTick): Record<string, string> {
  const width = 28
  return {
    left: `${((tick.position - width / 2) / geometry.value.width) * 100}%`,
    top: `${(geometry.value.margin.top / geometry.value.height) * 100}%`,
    width: `${(width / geometry.value.width) * 100}%`,
    height: `${(plotHeight.value / geometry.value.height) * 100}%`,
  }
}

function activateTick(key: string): void {
  if (pinnedTickKey.value === key) {
    pinnedTickKey.value = null
    hoveredTickKey.value = null
    return
  }
  pinnedTickKey.value = key
  hoveredTickKey.value = key
}

function dismissTick(): void {
  pinnedTickKey.value = null
  hoveredTickKey.value = null
}

function dismissOutside(event: Event): void {
  const target = event.target
  if (plotElement.value && target instanceof Node && !plotElement.value.contains(target)) dismissTick()
}

onMounted(() => document.addEventListener('pointerdown', dismissOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside))

const legendEntries = computed<readonly FigureLegendEntry[]>(() => {
  const canToggle = props.comparison.status === 'loading' || props.comparison.status === 'error' || comparisonAvailable.value
  return [
    {
      key: 'territory',
      label: 'Territoire',
      marker: 'line',
      tone: 'theme',
      ariaLabel: `Territoire : ${props.figure.territoryName}`,
    },
    {
      key: 'comparison',
      label: GROUPE_COMPARE_LABEL,
      marker: 'dash',
      tone: 'peer',
      persistentToggle: canToggle,
      ariaLabel: `${GROUPE_COMPARE_LABEL} : ${props.figure.comparisonLabel ?? UNAVAILABLE_LABEL}`,
    },
  ]
})
const legendColors = {
  territory: 'var(--brand-500)',
  comparison: 'var(--color-figure-reference, var(--cahier-default, var(--editorial-muted)))',
}
const legendSelected = computed(() => showComparison.value ? ['comparison'] : [])

function toggleLegend(key: string): void {
  if (key === 'comparison') comparisonVisible.value = !comparisonVisible.value
}

const stateMessage = computed(() => {
  if (props.comparison.status === 'loading') return 'Chargement du groupe comparé…'
  if (props.comparison.status === 'error') return props.comparison.error ?? 'Groupe comparé indisponible.'
  if (props.comparison.status === 'unavailable') return 'Aucun groupe comparé actif : aucune courbe de référence n’est affichée.'
  if (props.figure.comparison === null) return 'Aucune courbe de référence disponible pour cette sélection.'
  return null
})
</script>

<template>
  <div class="mobilite-raccordement-curve">
    <template v-if="figure.trajectory && figure.points.length">
      <CahierFigureFrame
        size="compact"
        :geometry="geometry"
        :x-title="figure.trajectory.axisLabels?.x"
        :y-title="figure.trajectory.axisLabels?.y"
      >
        <template #plot>
          <div ref="plotElement" class="mobilite-raccordement-curve__plot cahier-figure-plot">
            <svg
              class="mobilite-raccordement-curve__svg"
              :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              :aria-label="accessibleLabel"
            >
              <CahierFigureAxes :geometry="geometry" :x-ticks="xTicks" :y-ticks="yTicks" :show-labels="false" />
              <path class="mobilite-raccordement-curve__territory" data-series="territory" :d="territoryPath" />
              <circle
                v-for="(point, index) in figure.points"
                :key="`territory-${point.fact.detail ?? index}`"
                class="mobilite-raccordement-curve__point mobilite-raccordement-curve__point--territory"
                data-series="territory"
                :data-detail="point.fact.detail"
                :data-value="point.fact.value"
                :cx="xForAxis(numericAxisValue(point.fact, index))"
                :cy="point.fact.value === null ? plotBottom : yFor(point.fact.value)"
                r="2.6"
              />
              <path
                v-if="showComparison && comparisonPath"
                class="mobilite-raccordement-curve__comparison"
                data-series="comparison"
                :d="comparisonPath"
              />
              <g v-if="marker && markerX !== null" class="mobilite-raccordement-curve__marker" :data-detail="marker.detail">
                <line
                  class="mobilite-raccordement-curve__marker-line"
                  :x1="markerX"
                  :x2="markerX"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
                <circle
                  class="mobilite-raccordement-curve__marker-point"
                  :cx="markerX"
                  :cy="markerY"
                  r="4.5"
                />
                <text
                  class="mobilite-raccordement-curve__marker-label"
                  :x="markerX + 7"
                  :y="geometry.margin.top + 4"
                >{{ marker.label }}</text>
              </g>
            </svg>
            <CahierFigureAxisLabels :geometry="geometry" :x-ticks="xTicks" :y-ticks="yTicks" />
            <div class="mobilite-raccordement-curve__hitboxes" role="group" aria-label="Valeurs par temps de trajet">
              <button
                v-for="tick in xTicks"
                :key="`hit-${tick.key}`"
                type="button"
                class="mobilite-raccordement-curve__hitbox"
                :style="tickHitboxStyle(tick)"
                :aria-label="tickAriaLabel(tick)"
                @mouseenter="hoveredTickKey = String(tick.key)"
                @mouseleave="hoveredTickKey = null"
                @focus="hoveredTickKey = String(tick.key)"
                @blur="dismissTick"
                @click="activateTick(String(tick.key))"
                @keydown.esc="dismissTick"
              />
            </div>
            <CahierFigureTooltip
              v-if="selectedTick"
              class="mobilite-raccordement-curve__tooltip cahier-figure-tooltip--chart"
              :title="selectedTickTitle"
              :rows="tooltipRows(String(selectedTick.key))"
              :anchor="tooltipAnchor"
              aria-live="polite"
            />
          </div>
        </template>
      </CahierFigureFrame>

      <CahierFigureLegend
        class="mobilite-raccordement-curve__legend"
        :entries="legendEntries"
        :mark-colors="legendColors"
        :selected-keys="legendSelected"
        :comparison-status="comparison.status"
        :comparison-error="comparison.error"
        label="Séries et groupe comparé de la courbe de raccordement"
        @toggle="toggleLegend"
      />
    </template>
    <p v-else class="mobilite-raccordement-curve__unavailable">Repères de trajectoire indisponibles.</p>

    <p v-if="stateMessage" class="mobilite-raccordement-curve__state" role="status">
      <ComparisonUnavailableCue
        v-if="comparison.status === 'unavailable'"
        class="mobilite-raccordement-curve__cue"
        placement="below"
      />
      <span>{{ stateMessage }}</span>
    </p>
    <button
      v-if="comparison.status === 'error' && comparison.retry"
      type="button"
      class="mobilite-raccordement-curve__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.mobilite-raccordement-curve { display: grid; gap: var(--space-3); min-width: 0; }
.mobilite-raccordement-curve__plot { position: relative; width: 100%; }
.mobilite-raccordement-curve__svg { display: block; width: 100%; height: auto; overflow: visible; }
.mobilite-raccordement-curve__territory {
  fill: none;
  stroke: var(--brand-500);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mobilite-raccordement-curve__point--territory { fill: var(--paper); stroke: var(--brand-500); stroke-width: 2; }
.mobilite-raccordement-curve__comparison {
  fill: none;
  stroke: var(--color-figure-reference, var(--cahier-default, var(--editorial-muted)));
  stroke-width: 2;
  stroke-dasharray: 6 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mobilite-raccordement-curve__marker-line {
  stroke: var(--cahier-default, var(--editorial-muted));
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}
.mobilite-raccordement-curve__marker-point { fill: var(--paper); stroke: var(--brand-600, var(--brand-500)); stroke-width: 2.5; }
.mobilite-raccordement-curve__marker-label {
  fill: var(--cahier-default, var(--editorial-muted));
  font: var(--text-caption);
  font-weight: 700;
}
.mobilite-raccordement-curve__hitboxes { position: absolute; inset: 0; }
.mobilite-raccordement-curve__hitbox {
  position: absolute; display: block; margin: 0; padding: 0;
  border: 0; background: transparent; cursor: help;
}
.mobilite-raccordement-curve__hitbox:hover,
.mobilite-raccordement-curve__hitbox:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
.mobilite-raccordement-curve__tooltip { width: min(320px, calc(100vw - 32px)); max-width: calc(100% - 16px); pointer-events: none; }
.mobilite-raccordement-curve__legend { flex-wrap: wrap; }
.mobilite-raccordement-curve__state { margin: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--cahier-default, var(--editorial-muted)); font: var(--text-body-sm); }
.mobilite-raccordement-curve__unavailable { margin: 0; color: var(--cahier-default, var(--editorial-muted)); }
.mobilite-raccordement-curve__retry {
  justify-self: start; min-height: 2.75rem; padding: 0 var(--space-3);
  border: 0; border-radius: var(--radius-md); background: transparent;
  color: var(--text-secondary); font: var(--text-body-sm); text-decoration: underline; cursor: pointer;
}
.mobilite-raccordement-curve__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.mobilite-raccordement-curve__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
@media (max-width: 760px) {
  :deep(.cahier-figure-axis-labels .cahier-figure-tick-label.mobilite-raccordement-curve__tick--desktop) {
    display: none;
  }
}
</style>
