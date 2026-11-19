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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureTooltipAnchor,
  CahierTooltipRow,
  FigureLegendEntry,
} from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type {
  MobiliteBarCategoryEvidence,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
} from '@/fiche/content/themeContent'
import {
  mobiliteBarCategoryAria,
  mobiliteBarReadings,
  mobiliteBarReferenceValue,
  mobiliteBarResourceNotes,
  mobiliteBarSegmentColor,
  mobiliteBarToneColor,
  mobiliteBarTooltipRows,
  mobiliteBarsAccessibleLabel,
  mobiliteBarsComparisonStateText,
  mobiliteFiniteValue,
  mobiliteRatioValueLabel,
} from './cahierMobiliteReadings'
import {
  CAHIER_FIGURE_STROKE,
  cahierFigureStrokeVars,
  CAHIER_MOBILITE_BARS_GEOMETRY,
  mobiliteBarGeometry,
  mobiliteBarScale,
  mobiliteBarStackedSegments,
  mobiliteBarComparisonSegments,
  mobiliteBarXticks,
  mobiliteBarYTicks,
} from './cahierFigureNativeGeometry'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'
import { useCahierExportPublication, useCahierExportSlot } from './cahierExportVenue'
import { useCahierNativeRender } from './cahierNativeRenderContext'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteBarsFigureEvidence
  comparison: ComparisonState
  comparisonNone?: boolean
  ratio?: MobiliteRatioEvidence | null
}>()

const BASE_FIGURE_GEOMETRY = CAHIER_MOBILITE_BARS_GEOMETRY
/** Same stroke owner as the ramp/curve; the SVG binds it locally (#1024). */
const figureStrokeStyle = cahierFigureStrokeVars(CAHIER_FIGURE_STROKE)
const UNAVAILABLE_LABEL = 'Indisponible'
const finiteValue = mobiliteFiniteValue
const toneColor = mobiliteBarToneColor
const segmentColor = mobiliteBarSegmentColor
const referenceValue = mobiliteBarReferenceValue
const ratioValueLabel = mobiliteRatioValueLabel

const renderSlot = useCahierExportSlot()?.slotPath ?? ''
const comparisonVisible = ref(useCahierNativeRender()?.barToggles[renderSlot] ?? true)
// #1021 — this figure owns its comparison visibility and its drawn reference;
// the capture reads that effective observation, never a default.
useCahierExportPublication(() => ({
  owner: 'mobilite-comparison-bars',
  state: {
    toggle: comparisonVisible.value,
    referenceAvailable: hasComparisonReference.value,
    visibleReferenceAvailable: hasComparisonReference.value,
    displayed: comparisonAligned.value,
  },
}))
const plotElement = ref<HTMLElement | null>(null)
const hoveredCategoryIndex = ref<number | null>(null)
const pinnedCategoryIndex = ref<number | null>(null)
const selectedCategoryIndex = computed(() => pinnedCategoryIndex.value ?? hoveredCategoryIndex.value)

function activateCategory(index: number): void {
  if (pinnedCategoryIndex.value === index) {
    pinnedCategoryIndex.value = null
    hoveredCategoryIndex.value = null
    return
  }
  pinnedCategoryIndex.value = index
  hoveredCategoryIndex.value = index
}

function dismissCategory(): void {
  pinnedCategoryIndex.value = null
  hoveredCategoryIndex.value = null
}

function dismissOutside(event: Event): void {
  const target = event.target
  if (plotElement.value && target instanceof Node && !plotElement.value.contains(target)) {
    dismissCategory()
  }
}

onMounted(() => document.addEventListener('pointerdown', dismissOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside))

function formatAxisTick(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

function comparisonFill(category: MobiliteBarCategoryEvidence): string {
  return `color-mix(in srgb, ${toneColor(category.tone)} 45%, var(--paper))`
}

const showComparison = computed(() =>
  !props.comparisonNone && props.comparison.status === 'ready' && comparisonVisible.value,
)

const hasComparisonReference = computed(() =>
  props.figure.categories.some((category) => referenceValue(category) !== null),
)

const comparisonAligned = computed(() => showComparison.value && hasComparisonReference.value)
const categoryCount = computed(() => props.figure.categories.length)
const slotCount = computed(() => comparisonAligned.value ? 2 : 1)
const yScale = computed(() => mobiliteBarScale(props.figure, comparisonAligned.value))
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
const barGeometry = computed(() => mobiliteBarGeometry(
  figureGeometry.value,
  categoryCount.value,
  yScale.value,
  slotCount.value,
))

function yFor(value: number): number {
  return figureGeometry.value.margin.top +
    (1 - Math.max(0, value) / yMaximum.value) * plotHeight.value
}

function barWidth(): number {
  return barGeometry.value.barWidth
}

function barX(categoryIndex: number, slot: number): number {
  return barGeometry.value.x(categoryIndex, slot)
}

function barHeight(value: number): number {
  return barGeometry.value.height(value)
}

const xTicks = computed<readonly CahierFigureAxisTick[]>(() => mobiliteBarXticks(
  props.figure,
  figureGeometry.value,
  barGeometry.value,
))

const yAxisTicks = computed<readonly CahierFigureAxisTick[]>(() => mobiliteBarYTicks(
  yScale.value,
  figureGeometry.value,
))

function stackedSegments(category: MobiliteBarCategoryEvidence, categoryIndex: number) {
  return mobiliteBarStackedSegments(category, categoryIndex, figureGeometry.value, barGeometry.value)
}

/**
 * #997 — the compared bike bar is the served protected/shared mean stack, drawn
 * beside the focal stack with the same role inks at the compared 45 % mix. The
 * evidence builder has already proven one eligible population and an additive
 * total within machine-float slack.
 */
function comparisonStackedSegments(category: MobiliteBarCategoryEvidence, categoryIndex: number) {
  return mobiliteBarComparisonSegments(category, categoryIndex, figureGeometry.value, barGeometry.value)
}

function tooltipRows(category: MobiliteBarCategoryEvidence): readonly CahierTooltipRow[] {
  return mobiliteBarTooltipRows(mobiliteBarReadings({
    figure: props.figure,
    category,
    showComparison: showComparison.value,
  }))
}

function categoryAriaLabel(index: number): string {
  return mobiliteBarCategoryAria({
    figure: props.figure,
    category: props.figure.categories[index]!,
    showComparison: showComparison.value,
  })
}

const resourceNotes = computed(() => mobiliteBarResourceNotes({
  figure: props.figure,
  comparisonNone: props.comparisonNone,
}))

const accessibleLabel = computed(() => mobiliteBarsAccessibleLabel({
  figure: props.figure,
  showComparison: showComparison.value,
  comparisonNone: props.comparisonNone,
}))
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
  // #988 — every category is already named by the x axis, so a category key in
  // the legend would only repeat an axis label. The legend keeps the drawn
  // cycling segment series (the one distinction the axis cannot carry) and the
  // served comparison reference; each category's ink stays on the drawn bar.
  const entries: FigureLegendEntry[] = props.figure.categories.flatMap((category) =>
    category.segments.map((segment) => {
      const label = segment.legendLabel ?? segment.label
      return { key: segment.key, label, marker: 'square' as const, ariaLabel: `${label} : série du territoire` }
    }))
  const comparisonCanToggle = props.comparison.status === 'loading' ||
    props.comparison.status === 'error' ||
    (props.comparison.status === 'ready' && hasComparisonReference.value)
  if (!props.comparisonNone) entries.push({
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

const legendColors = computed<Readonly<Record<string, string>>>(() => ({
  protege_km_1000: segmentColor({ key: 'protege_km_1000' }),
  partage_km_1000: segmentColor({ key: 'partage_km_1000' }),
  comparison: 'color-mix(in srgb, var(--cahier-theme-strong, var(--brand-500)) 45%, var(--paper))',
}))

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

const comparisonStateText = computed(() => mobiliteBarsComparisonStateText({
  status: props.comparison.status,
  error: props.comparison.error,
  comparisonNone: props.comparisonNone,
}))

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
            :style="figureStrokeStyle"
            :viewBox="`0 0 ${figureGeometry.width} ${figureGeometry.height}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="accessibleLabel"
          >
            <g class="mobilite-comparison-bars__grid" aria-hidden="true">
              <line v-for="tick in yAxisTicks" :key="`y-${tick.key}`" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="tick.position" :y2="tick.position" />
              <line class="mobilite-comparison-bars__axis" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="plotBottom" :y2="plotBottom" />
            </g>
            <g
              v-for="(category, categoryIndex) in figure.categories"
              :key="category.key"
              :data-category="category.key"
              :data-total-height="finiteValue(category.value.fact.value) === null ? null : barHeight(category.value.fact.value!)"
            >
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
              <template v-if="showComparison && referenceValue(category) !== null">
                <g
                  v-if="category.comparisonSplit && comparisonStackedSegments(category, categoryIndex).length"
                  class="mobilite-comparison-bars__comparison"
                  :data-comparison="category.key"
                  data-comparison-split="true"
                >
                  <rect
                    v-for="segment in comparisonStackedSegments(category, categoryIndex)"
                    :key="`${category.key}-comparison-${segment.key}`"
                    class="mobilite-comparison-bars__comparison-segment"
                    :data-comparison-segment="segment.key"
                    :x="segment.x"
                    :y="segment.y"
                    :width="segment.width"
                    :height="segment.height"
                    :fill="segment.fill"
                    aria-hidden="true"
                  />
                </g>
                <rect
                  v-else
                  class="mobilite-comparison-bars__comparison"
                  :data-comparison="category.key"
                  :x="barX(categoryIndex, 1)"
                  :y="yFor(referenceValue(category)!)"
                  :width="barWidth()"
                  :height="barHeight(referenceValue(category)!)"
                  :fill="comparisonFill(category)"
                  aria-hidden="true"
                />
              </template>
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
              @mouseenter="hoveredCategoryIndex = index"
              @mouseleave="hoveredCategoryIndex = null"
              @focus="hoveredCategoryIndex = index"
              @blur="dismissCategory"
              @click="activateCategory(index)"
              @keydown.esc="dismissCategory"
            />
          </div>
          <CahierFigureTooltip
            v-if="selectedCategoryIndex !== null"
            class="mobilite-comparison-bars__tooltip cahier-figure-tooltip--chart"
            :title="selectedCategoryTitle"
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
      :label="comparisonNone ? 'Séries du territoire' : 'Séries du territoire et groupe comparé'"
      @toggle="toggleLegend"
    />

    <p
      v-for="category in figure.categories.filter((candidate) => candidate.splitNote)"
      :key="`split-${category.key}`"
      class="mobilite-comparison-state"
      role="note"
    >{{ category.splitNote }}</p>

    <p
      v-for="category in figure.categories.filter((candidate) => showComparison && candidate.comparisonSplitNote)"
      :key="`comparison-split-${category.key}`"
      class="mobilite-comparison-state"
      role="note"
    >{{ category.comparisonSplitNote }}</p>

    <p
      v-for="note in resourceNotes"
      :key="note"
      class="mobilite-comparison-state"
      role="note"
    >{{ note }}</p>

    <p v-if="comparisonStateText && comparison.status !== 'error'" class="mobilite-comparison-state" role="status">{{ comparisonStateText }}</p>
    <div v-else-if="comparisonStateText && comparison.status === 'error'" class="mobilite-comparison-error" role="status">
      <p>{{ comparisonStateText }}</p>
      <button v-if="comparison.retry" type="button" class="mobilite-comparison-retry" @click="comparison.retry()">Réessayer les comparaisons</button>
    </div>

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
.mobilite-comparison-bars__grid line { stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent); stroke-width: var(--cahier-figure-stroke-grid-width); }
.mobilite-comparison-bars__grid .mobilite-comparison-bars__axis { stroke: var(--cahier-theme-strong); stroke-width: var(--cahier-figure-stroke-axis-width); }
.mobilite-comparison-bars__bar { fill-opacity: .78; shape-rendering: crispEdges; }
.mobilite-comparison-bars__segment { fill-opacity: .9; shape-rendering: crispEdges; }
.mobilite-comparison-bars__comparison { fill-opacity: .62; shape-rendering: crispEdges; }
.mobilite-comparison-bars__comparison-segment { fill-opacity: .9; shape-rendering: crispEdges; }
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
.mobilite-ratio { display: grid; gap: var(--space-1); }
.mobilite-ratio__value { margin: 0; color: var(--cahier-default); font: var(--text-body-sm); }
.mobilite-ratio__note { margin: 0; color: var(--text-secondary); font: var(--text-caption); }
</style>
