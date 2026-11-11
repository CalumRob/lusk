<script setup lang="ts">
/**
 * The shared compared-vertical-bars family for the Mobilité sections (#954).
 *
 * Categories are vertical groups; each category may split into a segmented
 * territory bar (Protégé / Partagé) and always carries an optional compared bar
 * drawn at a 45 % mix of its series tone. The compared bike bar is the total
 * median and stays unsegmented (segment medians are never additive). Raw values
 * live in the tooltip only; the optional ratio line owns its reference and rank.
 */
import { computed, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureGeometry,
  CahierFigureTooltipAnchor,
  CahierTooltipComparison,
  CahierTooltipRow,
  FigureLegendEntry,
} from '@/fiche/cahierFigureGrammaire'
import { valeursGraduationPourDomaine } from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import { formatServedRank, formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import type {
  ContentFact,
  MobiliteBarCategoryEvidence,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
} from '@/fiche/content/themeContent'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
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
  figure: MobiliteBarsFigureEvidence
  comparison: ComparisonState
  ratio?: MobiliteRatioEvidence | null
}>()

const BASE_FIGURE_GEOMETRY = {
  width: 640,
  height: 300,
  margin: { top: 22, right: 24, bottom: 62, left: 68 },
} as const satisfies CahierFigureGeometry
const BAR_GAP = 3
const MAX_BAR_WIDTH = 20
const UNAVAILABLE_LABEL = 'Indisponible'

const comparisonVisible = ref(true)
const plotElement = ref<HTMLElement | null>(null)
const selectedCategoryIndex = ref<number | null>(null)

function formatValue(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

function formatAxisTick(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

function finiteValue(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

function toneColor(tone: MobiliteBarCategoryEvidence['tone']): string {
  return tone === 'c'
    ? 'var(--cahier-mode-car)'
    : tone === 'b'
      ? 'var(--cahier-mode-bike)'
      : tone === 't'
        ? 'var(--cahier-mode-foot)'
        : 'var(--cahier-theme-strong)'
}

function comparisonFill(category: MobiliteBarCategoryEvidence): string {
  return `color-mix(in srgb, ${toneColor(category.tone)} 45%, var(--paper))`
}

function referenceValue(category: MobiliteBarCategoryEvidence): number | null {
  return finiteValue(category.value.fact.comparison?.reference?.value)
}

const showComparison = computed(() =>
  props.comparison.status === 'ready' && comparisonVisible.value,
)

const hasComparisonReference = computed(() =>
  props.figure.categories.some((category) => referenceValue(category) !== null),
)

const comparisonAligned = computed(() => showComparison.value && hasComparisonReference.value)

const segmentColors: Readonly<Record<string, string>> = {
  protege_km_1000: 'var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))',
  partage_km_1000: 'var(--cahier-cycle-shared, #8c4c9e)',
}

function segmentColor(segment: { key: string }): string {
  return segmentColors[segment.key] ?? segmentColors.partage_km_1000
}

function comparisonStatistic(comparison: NonNullable<ContentFact['fact']['comparison']> | null | undefined): string {
  return comparison?.reference?.kind === 'mean' ? 'moyenne' : 'médiane'
}

function comparisonDirection(comparison: NonNullable<ContentFact['fact']['comparison']> | null | undefined): string | null {
  return comparison?.direction ? LIBELLES_DIRECTION[comparison.direction] : null
}

function comparisonScopeOnly(label: string | null): string | null {
  return label?.replace(/^(?:Médiane|Moyenne) des /u, '') ?? null
}

function comparisonDescription(
  comparison: NonNullable<ContentFact['fact']['comparison']> | null | undefined,
  scope: string | null,
  unsplitTotal = false,
): string {
  const statistic = comparisonStatistic(comparison)
  if (unsplitTotal) {
    const scopeOnly = comparisonScopeOnly(scope)
    return `${statistic} du total non segmenté${scopeOnly ? ` — ${scopeOnly}` : ''}`
  }
  return scope ?? statistic
}

function rankPhrase(
  comparison: NonNullable<ContentFact['fact']['comparison']> | null | undefined,
): string | null {
  if (!comparison) return null
  return puceRangDirection(comparison.rank, comparison.direction)?.phraseAria
    ?? formatServedRankAria(comparison.rank)
}

function comparisonAria(
  fact: ContentFact,
  scope: string | null,
  unit: string,
  unsplitTotal = false,
): string {
  const comparison = fact.fact.comparison
  const reference = comparison?.reference
  if (!reference) return `${GROUPE_COMPARE_LABEL} : Indisponible`
  const value = `${formatValue(reference.value)} ${unit}`
  const description = comparisonDescription(comparison, scope, unsplitTotal)
  const direction = comparisonDirection(comparison)
  const rank = rankPhrase(comparison)
  return `${GROUPE_COMPARE_LABEL} : ${value} (${description})${rank ? `. Rang ${rank}` : direction ? `. ${direction}` : ''}`
}

const categoryCount = computed(() => props.figure.categories.length)
const slotCount = computed(() => comparisonAligned.value ? 2 : 1)
const finiteValues = computed(() => props.figure.categories.flatMap((category) => {
  const values = [finiteValue(category.value.fact.value)]
  if (comparisonAligned.value) values.push(referenceValue(category))
  return values.filter((value): value is number => value !== null)
}))
const yScale = computed(() => {
  const maximum = Math.max(0, ...finiteValues.value)
  if (maximum <= 0) return { maximum: 1, ticks: [0, 1] }
  const ticks = valeursGraduationPourDomaine(maximum)
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : maximum
  // Round the domain up to a full graduation step so the exact data maximum
  // never crowds the last regular tick label.
  const roundedMaximum = Math.max(step, Math.ceil(maximum / step) * step)
  return { maximum: roundedMaximum, ticks: valeursGraduationPourDomaine(roundedMaximum) }
})
const yTicks = computed(() => yScale.value.ticks)
const yMaximum = computed(() => yScale.value.maximum)
const yTickLabels = computed(() => yTicks.value.map(formatAxisTick))
const figureGeometry = useMeasuredCahierFigureGeometry(
  plotElement,
  yTickLabels,
  BASE_FIGURE_GEOMETRY,
)
const plotWidth = computed(() => figureGeometry.value.width -
  figureGeometry.value.margin.left - figureGeometry.value.margin.right)
const plotHeight = computed(() => figureGeometry.value.height -
  figureGeometry.value.margin.top - figureGeometry.value.margin.bottom)
const plotBottom = computed(() => figureGeometry.value.margin.top + plotHeight.value)
const groupWidth = computed(() => plotWidth.value / Math.max(1, categoryCount.value))

function yFor(value: number): number {
  return figureGeometry.value.margin.top +
    (1 - Math.max(0, value) / yMaximum.value) * plotHeight.value
}

function barWidth(): number {
  const available = groupWidth.value * 0.72 - (slotCount.value - 1) * BAR_GAP
  return Math.max(4, Math.min(MAX_BAR_WIDTH, available / slotCount.value))
}

function barX(categoryIndex: number, slot: number): number {
  const width = barWidth()
  const clusterWidth = width * slotCount.value + BAR_GAP * (slotCount.value - 1)
  return figureGeometry.value.margin.left + categoryIndex * groupWidth.value +
    (groupWidth.value - clusterWidth) / 2 + slot * (width + BAR_GAP)
}

function barHeight(value: number): number {
  return Math.max(0, Math.abs(yFor(value) - yFor(0)))
}

const xTicks = computed<CahierFigureAxisTick[]>(() => props.figure.categories.map((category, index) => ({
  key: category.key,
  position: figureGeometry.value.margin.left + (index + 0.5) * groupWidth.value,
  label: category.axisLabel,
})))

const yAxisTicks = computed<CahierFigureAxisTick[]>(() => yTicks.value.map((value) => ({
  key: value,
  position: yFor(value),
  label: formatAxisTick(value),
})))

function stackedSegments(category: MobiliteBarCategoryEvidence, categoryIndex: number) {
  const total = finiteValue(category.value.fact.value)
  if (total === null || total <= 0) return []
  const segments = category.segments.map((segment) => ({ ...segment, numeric: finiteValue(segment.value.fact.value) }))
  if (!segments.length || segments.some((segment) => segment.numeric === null)) return []
  let offset = 0
  return segments.map((segment) => {
    const value = segment.numeric as number
    const height = (Math.max(0, value) / total) * barHeight(total)
    const y = plotBottom.value - offset - height
    offset += height
    return {
      key: segment.key,
      label: segment.label,
      x: barX(categoryIndex, 0),
      y,
      width: barWidth(),
      height,
      fill: segmentColor(segment),
    }
  })
}

function comparisonTooltip(
  fact: ContentFact,
  unit: string,
  unsplitTotal = false,
): CahierTooltipComparison | undefined {
  const comparison = fact.fact.comparison
  const reference = comparison?.reference
  if (!reference) return undefined
  const value = `${formatValue(reference.value)}${unit ? ` ${unit}` : ''}`
  return {
    value,
    rank: formatServedRank(comparison.rank),
    ariaLabel: comparisonAria(fact, props.figure.comparisonLabel, unit, unsplitTotal),
  }
}

function tooltipRows(category: MobiliteBarCategoryEvidence): readonly CahierTooltipRow[] {
  const value = finiteValue(category.value.fact.value)
  const rows: CahierTooltipRow[] = [{
    label: category.label,
    value: value === null ? UNAVAILABLE_LABEL : formatValue(value),
    markerColor: toneColor(category.tone),
    ariaLabel: `${category.label} : ${value === null ? UNAVAILABLE_LABEL : `${formatValue(value)} ${props.figure.unit}`}`,
    comparison: showComparison.value ? comparisonTooltip(category.value, props.figure.unit) : undefined,
  }]
  for (const segment of category.segments) {
    const segmentValue = finiteValue(segment.value.fact.value)
    rows.push({
      label: segment.label,
      value: segmentValue === null ? UNAVAILABLE_LABEL : formatValue(segmentValue),
      tone: 'b',
      marker: 'dot',
      markerColor: segmentColor(segment),
      ariaLabel: `${segment.label} : ${segmentValue === null ? UNAVAILABLE_LABEL : `${formatValue(segmentValue)} ${props.figure.unit}`}`,
      comparison: showComparison.value ? comparisonTooltip(segment.value, props.figure.unit) : undefined,
    })
    if (segment.rawValue) {
      const raw = finiteValue(segment.rawValue.fact.value)
      rows.push({
        label: segment.rawValue.label,
        value: raw === null ? UNAVAILABLE_LABEL : `${formatValue(raw)} ${segment.rawValue.fact.unit}`,
        tone: 'neutral',
        marker: 'slash',
        ariaLabel: `${segment.rawValue.label} : ${raw === null ? UNAVAILABLE_LABEL : `${formatValue(raw)} ${segment.rawValue.fact.unit}`} (valeur brute)`,
        comparison: showComparison.value ? comparisonTooltip(segment.rawValue, segment.rawValue.fact.unit) : undefined,
      })
    }
  }
  if (category.rawValue) {
    const raw = finiteValue(category.rawValue.fact.value)
    rows.push({
      label: category.rawValue.label,
      value: raw === null ? UNAVAILABLE_LABEL : `${formatValue(raw)} ${category.rawValue.fact.unit}`,
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: `${category.rawValue.label} : ${raw === null ? UNAVAILABLE_LABEL : `${formatValue(raw)} ${category.rawValue.fact.unit}`} (valeur brute)`,
      comparison: showComparison.value ? comparisonTooltip(category.rawValue, category.rawValue.fact.unit) : undefined,
    })
  }
  return rows
}

function categoryAriaLabel(index: number): string {
  const category = props.figure.categories[index]!
  const value = finiteValue(category.value.fact.value)
  const parts = [`${category.label} : ${value === null ? UNAVAILABLE_LABEL : `${formatValue(value)} ${props.figure.unit}`}`]
  for (const segment of category.segments) {
    const segmentValue = finiteValue(segment.value.fact.value)
    parts.push(`${segment.label} : ${segmentValue === null ? UNAVAILABLE_LABEL : `${formatValue(segmentValue)} ${props.figure.unit}`}`)
    if (showComparison.value) {
      const comparison = segment.value.fact.comparison
      const reference = comparison?.reference
      if (reference) {
        const rank = rankPhrase(comparison)
        const direction = comparisonDirection(comparison)
        parts.push(`${GROUPE_COMPARE_LABEL} ${segment.label} : ${formatValue(reference.value)} ${props.figure.unit}${rank ? ` — rang ${rank}` : direction ? ` — ${direction}` : ''}`)
      }
    }
  }
  if (showComparison.value) {
    const reference = referenceValue(category)
    if (reference !== null) {
      const comparison = category.value.fact.comparison!
      const unsplit = category.segments.length > 0
      const description = comparisonDescription(comparison, props.figure.comparisonLabel, unsplit)
      const rank = rankPhrase(comparison)
      const direction = comparisonDirection(comparison)
      parts.push(`${GROUPE_COMPARE_LABEL} : ${formatValue(reference)} ${props.figure.unit} (${description})${rank ? ` — rang ${rank}` : direction ? ` — ${direction}` : ''}`)
    } else {
      parts.push(`${GROUPE_COMPARE_LABEL} : Indisponible`)
    }
  }
  return parts.join(' ; ')
}

const accessibleLabel = computed(() => {
  const readings = props.figure.categories.map((_category, index) => categoryAriaLabel(index)).join(' ; ')
  return `${props.figure.figureTitle}. Barres verticales groupées par ${props.figure.xAxisTitle.toLocaleLowerCase('fr-FR')}, en ${props.figure.unit}. ${readings}. Axe horizontal : ${props.figure.xAxisTitle}. Axe vertical : ${props.figure.yAxisTitle}.`
})

const selectedCategoryTitle = computed(() => selectedCategoryIndex.value === null
  ? ''
  : props.figure.categories[selectedCategoryIndex.value]!.label)

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (selectedCategoryIndex.value === null) return undefined
  const category = props.figure.categories[selectedCategoryIndex.value]!
  const values = [finiteValue(category.value.fact.value)]
  if (showComparison.value) values.push(referenceValue(category))
  const highest = Math.max(0, ...values.filter((value): value is number => value !== null))
  return {
    x: `${((figureGeometry.value.margin.left + (selectedCategoryIndex.value + 0.5) * groupWidth.value) / figureGeometry.value.width) * 100}%`,
    y: `${Math.max(0.14, Math.min(0.84, yFor(highest) / figureGeometry.value.height)) * 100}%`,
  }
})

const legendEntries = computed<readonly FigureLegendEntry[]>(() => {
  const entries: FigureLegendEntry[] = props.figure.categories.map((category) => ({
    key: category.key,
    label: category.label,
    marker: 'square',
    ariaLabel: `${category.label} : série du territoire`,
  }))
  const segments = props.figure.categories.flatMap((category) => category.segments)
  if (segments.some((segment) => segment.key === 'protege_km_1000')) {
    entries.push({ key: 'protege_km_1000', label: 'Protégé', marker: 'square' })
  }
  if (segments.some((segment) => segment.key === 'partage_km_1000')) {
    entries.push({ key: 'partage_km_1000', label: 'Partagé', marker: 'square' })
  }
  const comparisonCanToggle = props.comparison.status === 'loading' ||
    props.comparison.status === 'error' ||
    (props.comparison.status === 'ready' && hasComparisonReference.value)
  entries.push({
    key: 'comparison',
    label: GROUPE_COMPARE_LABEL,
    // A compared BAR, never a line/dash: the square carries the 45 % mix fill.
    marker: 'square',
    tone: 'peer',
    persistentToggle: comparisonCanToggle,
    ariaLabel: `${GROUPE_COMPARE_LABEL} : ${props.figure.comparisonLabel ?? UNAVAILABLE_LABEL}`,
  })
  return entries
})

const legendColors = computed<Readonly<Record<string, string>>>(() => {
  const colors: Record<string, string> = Object.fromEntries(
    props.figure.categories.map((category) => [category.key, toneColor(category.tone)]),
  )
  colors.protege_km_1000 = segmentColors.protege_km_1000
  colors.partage_km_1000 = segmentColors.partage_km_1000
  colors.comparison = 'color-mix(in srgb, var(--cahier-theme-strong, var(--brand-500)) 45%, var(--paper))'
  return colors
})

const legendSelected = computed(() => showComparison.value ? ['comparison'] : [])

function toggleLegend(key: string): void {
  if (key === 'comparison') comparisonVisible.value = !comparisonVisible.value
}

function categoryHitboxStyle(index: number): Record<string, string> {
  return {
    left: `${(figureGeometry.value.margin.left + index * groupWidth.value) / figureGeometry.value.width * 100}%`,
    top: `${figureGeometry.value.margin.top / figureGeometry.value.height * 100}%`,
    width: `${groupWidth.value / figureGeometry.value.width * 100}%`,
    height: `${plotHeight.value / figureGeometry.value.height * 100}%`,
  }
}

function ratioValueLabel(ratio: MobiliteRatioEvidence): string {
  const value = finiteValue(ratio.value.fact.value)
  return value === null ? UNAVAILABLE_LABEL : `${formatValue(value)} ${ratio.value.fact.unit}`
}

const ratioComparisonStatus = computed(() => props.comparison.status)
</script>

<template>
  <div class="mobilite-comparison-bars">
    <CahierFigureFrame
      size="compact"
      :geometry="figureGeometry"
      :x-title="figure.xAxisTitle"
      :y-title="figure.yAxisTitle"
    >
      <template #plot>
        <div ref="plotElement" class="mobilite-comparison-bars__plot cahier-figure-plot">
          <svg
            class="mobilite-comparison-bars__svg"
            :viewBox="`0 0 ${figureGeometry.width} ${figureGeometry.height}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="accessibleLabel"
          >
            <g class="mobilite-comparison-bars__grid" aria-hidden="true">
              <line v-for="tick in yAxisTicks" :key="`y-${tick.key}`" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="tick.position" :y2="tick.position" />
              <line class="mobilite-comparison-bars__axis" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="plotBottom" :y2="plotBottom" />
            </g>
            <g v-for="(category, categoryIndex) in figure.categories" :key="category.key">
              <template v-if="finiteValue(category.value.fact.value) !== null">
                <template v-if="stackedSegments(category, categoryIndex).length">
                  <rect
                    v-for="segment in stackedSegments(category, categoryIndex)"
                    :key="`${category.key}-${segment.key}`"
                    class="mobilite-comparison-bars__segment"
                    :data-segment="segment.key"
                    :x="segment.x"
                    :y="segment.y"
                    :width="segment.width"
                    :height="segment.height"
                    :fill="segment.fill"
                    aria-hidden="true"
                  />
                </template>
                <rect
                  v-else
                  class="mobilite-comparison-bars__bar"
                  :data-category="category.key"
                  :x="barX(categoryIndex, 0)"
                  :y="yFor(category.value.fact.value!)"
                  :width="barWidth()"
                  :height="barHeight(category.value.fact.value!)"
                  :fill="toneColor(category.tone)"
                  aria-hidden="true"
                />
              </template>
              <rect
                v-if="showComparison && referenceValue(category) !== null"
                class="mobilite-comparison-bars__comparison"
                :data-comparison="category.key"
                :x="barX(categoryIndex, 1)"
                :y="yFor(referenceValue(category)!)"
                :width="barWidth()"
                :height="barHeight(referenceValue(category)!)"
                :fill="comparisonFill(category)"
                aria-hidden="true"
              />
            </g>
          </svg>
          <CahierFigureAxisLabels :geometry="figureGeometry" :x-ticks="xTicks" :y-ticks="yAxisTicks" :x-label-offset="8" />
          <div class="mobilite-comparison-bars__hitboxes" role="group" :aria-label="`Détails par ${figure.xAxisTitle.toLocaleLowerCase('fr-FR')}`">
            <button
              v-for="(category, index) in figure.categories"
              :key="category.key"
              class="mobilite-comparison-bars__hitbox"
              type="button"
              :style="categoryHitboxStyle(index)"
              :aria-label="categoryAriaLabel(index)"
              @mouseenter="selectedCategoryIndex = index"
              @mouseleave="selectedCategoryIndex = null"
              @focus="selectedCategoryIndex = index"
              @blur="selectedCategoryIndex = null"
              @click="selectedCategoryIndex = selectedCategoryIndex === index ? null : index"
              @keydown.esc="selectedCategoryIndex = null"
            />
          </div>
          <CahierFigureTooltip
            v-if="selectedCategoryIndex !== null"
            class="mobilite-comparison-bars__tooltip cahier-figure-tooltip--chart"
            :title="selectedCategoryTitle"
            :unit="figure.unit"
            :rows="tooltipRows(figure.categories[selectedCategoryIndex]!)"
            :anchor="tooltipAnchor"
            aria-live="polite"
          />
        </div>
      </template>
    </CahierFigureFrame>

    <CahierFigureLegend
      class="mobilite-comparison-bars__legend"
      :entries="legendEntries"
      :mark-colors="legendColors"
      :selected-keys="legendSelected"
      :comparison-status="comparison.status"
      :comparison-error="comparison.error"
      label="Séries, Protégé, Partagé et groupe comparé"
      @toggle="toggleLegend"
    />

    <p v-if="comparison.status === 'loading'" class="mobilite-comparison-state" role="status">Chargement du groupe comparé…</p>
    <div v-else-if="comparison.status === 'error'" class="mobilite-comparison-error" role="status">
      <p>Groupe comparé indisponible.</p>
      <button v-if="comparison.retry" type="button" class="mobilite-comparison-retry" @click="comparison.retry()">Réessayer les comparaisons</button>
    </div>
    <p v-else-if="comparison.status === 'unavailable'" class="mobilite-comparison-state" role="status">Groupe comparé indisponible pour cette sélection.</p>

    <div v-if="ratio" class="mobilite-ratio">
      <p class="mobilite-ratio__value">
        {{ ratio.label }} : <strong>{{ ratioValueLabel(ratio) }}</strong>
      </p>
      <CahierComparisonValue
        :fact="ratio.value.fact"
        :comparison-status="ratioComparisonStatus"
        :comparison-error="comparison.error"
      />
      <p v-if="ratio.note" class="mobilite-ratio__note">{{ ratio.note }}</p>
    </div>
  </div>
</template>

<style scoped>
.mobilite-comparison-bars { display: grid; gap: var(--space-3); min-width: 0; }
.mobilite-comparison-bars__plot { position: relative; width: 100%; }
.mobilite-comparison-bars__svg { display: block; width: 100%; height: auto; overflow: visible; }
.mobilite-comparison-bars__grid line { stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent); stroke-width: 1; }
.mobilite-comparison-bars__grid .mobilite-comparison-bars__axis { stroke: var(--cahier-theme-strong); stroke-width: 1.5; }
.mobilite-comparison-bars__bar { fill-opacity: .78; shape-rendering: crispEdges; }
.mobilite-comparison-bars__segment { fill-opacity: .9; shape-rendering: crispEdges; }
.mobilite-comparison-bars__comparison { fill-opacity: .62; shape-rendering: crispEdges; }
.mobilite-comparison-bars__hitboxes { position: absolute; inset: 0; }
.mobilite-comparison-bars__hitbox { position: absolute; display: block; margin: 0; padding: 0; border: 0; background: transparent; cursor: help; }
.mobilite-comparison-bars__hitbox:hover, .mobilite-comparison-bars__hitbox:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
.mobilite-comparison-bars__tooltip { width: min(320px, calc(100vw - 32px)); max-width: calc(100% - 16px); pointer-events: none; }
.mobilite-comparison-bars__legend { flex-wrap: wrap; }
.mobilite-comparison-state { margin: 0; color: var(--cahier-default); font: var(--text-body-sm); }
.mobilite-comparison-error { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; color: var(--cahier-default); font: var(--text-body-sm); }
.mobilite-comparison-error p { margin: 0; }
.mobilite-comparison-retry { min-height: 2.75rem; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font: var(--text-body-sm); text-decoration: underline; cursor: pointer; }
.mobilite-comparison-retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.mobilite-comparison-retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.mobilite-ratio { display: grid; gap: var(--space-1); border-top: 1px solid color-mix(in srgb, var(--cahier-theme) 22%, var(--paper)); padding-top: var(--space-3); }
.mobilite-ratio__value { margin: 0; color: var(--cahier-default); font: var(--text-body-sm); }
.mobilite-ratio__note { margin: 0; color: var(--text-secondary); font: var(--text-caption); }
</style>
