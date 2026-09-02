<script setup lang="ts">
/**
 * [PROTOTYPE #511 — JETABLE] Variante D — « Cahier libre ».
 *
 * This surface is deliberately content-only. ThemeContent owns the semantic
 * claims, evidence, availability, provenance, wording, and exploration
 * targets. CahierPagination owns the presentation sequence. This component
 * only lays those two inputs out as the existing Cahier exploration.
 */
import {
  Bike,
  CarFront,
  Footprints,
  HeartPulse,
  Landmark,
  School,
  Utensils,
  WalletCards,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'

import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import type {
  AccessEvidence,
  ContentFact,
  ContentSection,
  DistributionEvidence,
  ExplorationTarget,
  SummaryEvidence,
  ThemeContent,
} from '@/fiche/content/themeContent'
import {
  routePourCibleExploration,
  routePourSectionExploration,
} from '@/fiche/explorationHandoff'
import {
  MOBILITE_MODE_LABELS,
  nomTerritoirePourAffichage,
} from '@/fiche/content/territoryFacts'
import type { MobiliteAccessMode, MobiliteService, NumericFact } from '@/fiche/content/territoryFacts'
import { CAHIER_FIGURE_STYLE, normaliserPartsDonut } from '@/fiche/cahierFigureGrammaire'
import type { CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import { layoutMasonry } from '@/fiche/masonryLayout'
import type { CahierPagination } from './cahierPagination'
import CahierProse from './CahierProse.vue'
import CahierDonut from './CahierDonut.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierReferenceNote from './CahierReferenceNote.vue'
import BpeProfilesChartCahier from './BpeProfilesChartCahier.vue'
import DistributionFigureCahier from './DistributionFigureCahier.vue'
import { useCahierBaselineGrid } from './useCahierBaselineGrid'

const props = defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  presentation?: 'ruled' | 'plain'
}>()

const rootRef = ref<HTMLElement | null>(null)
const figureStackRef = ref<HTMLElement | null>(null)
const activeFigure = ref('')
const masonryReady = ref(false)
const masonryHeight = ref(0)
const sectionPlacements = ref<Record<string, { column: 0 | 1; top: number }>>({})
const sectionElements = new Map<string, HTMLElement>()
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let masonryQueued = false
const MASONRY_TWO_COLUMN_QUERY = '(min-width: 1281px)'

const unit = computed(() => props.content.units[0] ?? null)
const sections = computed(() => unit.value?.sections ?? [])
const pageEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === unit.value?.key) ?? null,
)
const sourceEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === 'sources') ?? null,
)
const comparisonReference = computed(() => {
  for (const section of sections.value) {
    const evidence = section.evidence
    if (
      evidence &&
      evidence.kind !== 'bpe-profiles' &&
      evidence.referenceLabel
    ) {
      return evidence.referenceLabel
    }
  }
  return null
})

const FIGURE_REFERENCE_LABEL = 'vs ref*'

function referenceLabelForFigure(referenceLabel: string | null): string | null {
  return referenceLabel ? FIGURE_REFERENCE_LABEL : null
}

function setSectionElement(key: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    sectionElements.set(key, element)
    resizeObserver?.observe(element)
  } else {
    sectionElements.delete(key)
  }
}

function usesTwoColumns(): boolean {
  return typeof window === 'undefined'
    || typeof window.matchMedia !== 'function'
    || window.matchMedia(MASONRY_TWO_COLUMN_QUERY).matches
}

function styleForSection(key: string): Record<string, string> | undefined {
  const placement = sectionPlacements.value[key]
  if (!placement) return undefined
  const twoColumns = usesTwoColumns()
  return {
    '--masonry-top': `${placement.top}px`,
    '--masonry-left':
      twoColumns && placement.column === 1
        ? 'calc(50% + var(--masonry-half-gap))'
        : '0px',
    '--masonry-width': twoColumns ? 'calc(50% - var(--masonry-half-gap))' : '100%',
  }
}

function measureMasonry(): void {
  const stack = figureStackRef.value
  if (!stack) return

  const elements = sections.value.map((section) => sectionElements.get(section.key))
  if (elements.some((element) => !element)) return

  const twoColumns = usesTwoColumns()
  const gap = Number.parseFloat(getComputedStyle(stack).getPropertyValue('--masonry-gap')) || 32
  const layout = layoutMasonry(
    sections.value.map((section, index) => ({
      key: section.key,
      height: elements[index]?.getBoundingClientRect().height ?? 0,
    })),
    { columns: twoColumns ? 2 : 1, gap },
  )

  sectionPlacements.value = Object.fromEntries(
    layout.placements.map((placement) => [placement.key, placement]),
  )
  masonryHeight.value = layout.height
  masonryReady.value = true
}

function scheduleMasonry(): void {
  if (masonryQueued) return
  masonryQueued = true
  void nextTick(() => {
    masonryQueued = false
    measureMasonry()
  })
}

const SERVICE_ICONS: Readonly<Record<MobiliteService, Component>> = {
  administration: Landmark,
  alimentation: Utensils,
  sante: HeartPulse,
  banque: WalletCards,
  ecole: School,
}

const MODE_ICONS: Readonly<Record<MobiliteAccessMode, Component>> = {
  car: CarFront,
  bike: Bike,
  walkTransit: Footprints,
}

const MODE_CLASSES: Readonly<Record<MobiliteAccessMode, string>> = {
  car: 'c',
  bike: 'b',
  walkTransit: 't',
}

const SUMMARY_MODES = ['walkTransit', 'bike', 'car'] as const

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)
}

function formatFact(fact: NumericFact | null | undefined): string {
  if (!fact || fact.value === null) return '—'
  return fact.unit === '%' ? `${formatNumber(fact.value * 100, 0)} %` : formatNumber(fact.value)
}

function formatFactValue(fact: NumericFact, value: number | null): string {
  return formatFact({ ...fact, value })
}

function summaryMetrics(evidence: SummaryEvidence): readonly {
  key: 'equipment' | 'types'
  title: string
  values: SummaryEvidence['accessibleEquipment']
}[] {
  return [
    { key: 'equipment', title: 'Équipements accessibles', values: evidence.accessibleEquipment },
    { key: 'types', title: 'Types d’équipements accessibles', values: evidence.accessibleTypes },
  ]
}

function summaryMetricTitle(key: 'equipment' | 'types'): string {
  return key === 'equipment' ? 'Nombre d’équip. accessibles' : "Types d'équip. accessibles"
}

type SummaryBarSegment = {
  mode: MobiliteAccessMode | 'inaccessible'
  fact: ContentFact
  start: number
  end: number
}

type RenderedSummaryBarSegment = SummaryBarSegment & {
  label: string
  icon: Component | null
  value: number | null
  left: string
  right: string
}

function summaryHasValues(values: SummaryEvidence['accessibleEquipment']): boolean {
  return Object.values(values).some((value) => value.fact.value !== null)
}

function summaryHasReference(values: SummaryEvidence['accessibleEquipment']): boolean {
  return Object.values(values).some((value) => value.fact.comparison?.reference?.value !== undefined)
}

function summaryScale(
  values: SummaryEvidence['accessibleEquipment'],
  metric?: 'equipment' | 'types',
  typeCount?: number | null,
): number {
  if (metric === 'types' && typeCount !== null && typeCount !== undefined) {
    return Math.max(0, typeCount)
  }
  if (metric === 'equipment') {
    return Math.max(
      0,
      values.car.fact.value ?? 0,
      values.car.fact.comparison?.reference?.value ?? 0,
    )
  }
  return Math.max(
    0,
    ...Object.values(values).flatMap((value) => [
      value.fact.value ?? 0,
      value.fact.comparison?.reference?.value ?? 0,
    ]),
  )
}

function summarySegments(
  values: SummaryEvidence['accessibleEquipment'],
  metric?: 'equipment' | 'types',
  typeCount?: number | null,
  inaccessibleTypes?: ContentFact,
): readonly RenderedSummaryBarSegment[] {
  return summaryBarSegments(values, false, metric, typeCount, inaccessibleTypes)
}

function summaryBarSegments(
  values: SummaryEvidence['accessibleEquipment'],
  reference: boolean,
  metric?: 'equipment' | 'types',
  typeCount?: number | null,
  inaccessibleTypes?: ContentFact,
): readonly RenderedSummaryBarSegment[] {
  const scale = summaryScale(values, metric, typeCount)
  const valueFor = (mode: MobiliteAccessMode): number | null => reference
    ? values[mode].fact.comparison?.reference?.value ?? null
    : values[mode].fact.value
  const walk = Math.max(0, valueFor('walkTransit') ?? 0)
  const bike = Math.max(walk, valueFor('bike') ?? 0)
  const car = Math.min(scale, Math.max(bike, valueFor('car') ?? 0))
  const inaccessibleValue = inaccessibleTypes
    ? reference
      ? inaccessibleTypes.fact.comparison?.reference?.value ?? null
      : inaccessibleTypes.fact.value
    : null
  const segments: SummaryBarSegment[] = [
    { mode: 'walkTransit' as const, start: 0, end: walk, fact: values.walkTransit },
    { mode: 'bike' as const, start: walk, end: bike, fact: values.bike },
    { mode: 'car' as const, start: bike, end: car, fact: values.car },
  ]
  if (metric === 'types' && inaccessibleTypes) {
    if (inaccessibleValue !== null && scale > 0) {
      segments.push({
        mode: 'inaccessible' as const,
        start: car,
        end: scale,
        fact: inaccessibleTypes,
      })
    }
  }
  return segments.map((segment) => ({
    ...segment,
    value: segment.mode === 'inaccessible' ? inaccessibleValue : valueFor(segment.mode),
    label: segment.mode === 'inaccessible' ? segment.fact.label : MOBILITE_MODE_LABELS[segment.mode],
    icon: segment.mode === 'inaccessible' ? null : modeIcon(segment.mode),
    left: scale > 0 ? `${(segment.start / scale) * 100}%` : '0%',
    right: scale > 0 ? `${100 - (segment.end / scale) * 100}%` : '100%',
  }))
}

function summarySegmentClass(mode: MobiliteAccessMode | 'inaccessible'): string {
  return mode === 'inaccessible' ? 'inaccessible' : MODE_CLASSES[mode]
}

function summaryBarTooltipId(key: 'equipment' | 'types', reference: boolean): string {
  return `summary-${key}-${reference ? 'reference' : 'territory'}-detail`
}

function summaryTooltipRows(
  values: SummaryEvidence['accessibleEquipment'],
  reference: boolean,
  metric?: 'equipment' | 'types',
  typeCount?: number | null,
  inaccessibleTypes?: ContentFact,
): readonly CahierTooltipRow[] {
  return summaryBarSegments(values, reference, metric, typeCount, inaccessibleTypes).map((segment) => ({
    label: segment.label,
    value: formatFactValue(segment.fact.fact, segment.value),
    tone: segment.mode === 'inaccessible'
      ? 'neutral'
      : MODE_CLASSES[segment.mode] as CahierTooltipRow['tone'],
    marker: segment.mode === 'inaccessible' ? 'slash' : undefined,
  }))
}

function summaryLosses(
  evidence: SummaryEvidence,
  metric: 'equipment' | 'types',
): readonly {
  mode: 'walkTransit' | 'bike'
  label: string
  fact: ContentFact
}[] {
  const values = metric === 'equipment' ? evidence.averageLosses.total : evidence.averageLosses.diversity
  return [
    {
      mode: 'walkTransit',
      label: MOBILITE_MODE_LABELS.walkTransit,
      fact: values.walkTransit,
    },
    {
      mode: 'bike',
      label: MOBILITE_MODE_LABELS.bike,
      fact: values.bike,
    },
  ]
}

function summaryLoss(values: SummaryEvidence['accessibleEquipment'], mode: MobiliteAccessMode): number | null {
  const car = values.car.fact.value
  const current = values[mode].fact.value
  return car === null || current === null || mode === 'car' ? null : Math.max(0, car - current)
}

function summaryLossForSegment(
  values: SummaryEvidence['accessibleEquipment'],
  segment: RenderedSummaryBarSegment,
): number | null {
  return segment.mode === 'inaccessible' ? null : summaryLoss(values, segment.mode)
}

function donutStyle(values: { car: number; bike: number; walkTransit: number }): Record<string, string> {
  const { walkTransit: walk, bike, car } = normaliserPartsDonut(values)
  return {
    '--donut-walk': `${walk * 360}deg`,
    '--donut-bike': `${bike * 360}deg`,
    '--donut-car': `${car * 360}deg`,
  }
}

function isExtreme(fact: NumericFact): boolean {
  const rank = fact.comparison?.rank
  if (!rank) return false
  const edge = Math.max(1, Math.ceil(rank.size * 0.05))
  return rank.position <= edge || rank.position > rank.size - edge
}

function referenceFactText(fact: NumericFact): string {
  if (!fact.comparison?.reference) return '—'
  return formatFact({ ...fact, value: fact.comparison.reference.value })
}

function explorationLinks(section: ContentSection): readonly {
  target: ExplorationTarget
  to: NonNullable<ReturnType<typeof routePourCibleExploration>>
}[] {
  return section.explorationTargets.flatMap((target) => {
    const to = routePourCibleExploration(target)
    return to ? [{ target, to }] : []
  })
}

function sectionExploration(section: ContentSection) {
  return explorationLinks(section)[0]?.to ?? routePourSectionExploration(section, {
    territoire: props.content.territory.code,
    type: props.content.territory.type,
  })
}

function anchorForEntry(key: string): string {
  return props.pagination.entries.find((entry) => entry.key === key)?.anchor ?? `figure-${key}`
}

function sectionState(section: ContentSection): string {
  return section.availability === 'absent'
    ? 'Contenu indisponible pour ce territoire.'
    : 'Lecture indisponible avec les données disponibles.'
}

function percentage(value: NumericFact): number | null {
  return value.value === null ? null : Math.max(0, Math.min(1, value.value))
}

function accessDonutStyle(service: AccessEvidence['services'][number]): Record<string, string> {
  return donutStyle({
    walkTransit: percentage(service.modes.walkTransit.fact) ?? 0,
    bike: percentage(service.modes.bike.fact) ?? 0,
    car: percentage(service.modes.car.fact) ?? 0,
  })
}

function accessTooltipId(service: MobiliteService): string {
  return `access-${service}-detail`
}

function accessTooltipRows(
  service: AccessEvidence['services'][number],
  referenceLabel: string | null,
): readonly CahierTooltipRow[] {
  return [
    ...SUMMARY_MODES.map((mode) => ({
      label: service.modes[mode].label,
      value: formatFact(service.modes[mode].fact),
      tone: MODE_CLASSES[mode] as CahierTooltipRow['tone'],
      note: service.modes[mode].fact.comparison?.reference
        ? `${referenceLabelForFigure(referenceLabel) ?? 'Référence'} : ${referenceFactText(service.modes[mode].fact)}`
        : undefined,
    })),
    {
      label: service.inaccessible.label,
      value: formatFact(service.inaccessible.fact),
      tone: 'neutral' as const,
      marker: 'slash' as const,
      note: service.inaccessible.fact.comparison?.reference
        ? `${referenceLabelForFigure(referenceLabel) ?? 'Référence'} : ${referenceFactText(service.inaccessible.fact)}`
        : undefined,
    },
  ]
}

function serviceIcon(service: MobiliteService): Component {
  return SERVICE_ICONS[service]
}

function modeIcon(mode: MobiliteAccessMode): Component {
  return MODE_ICONS[mode]
}

function diversityModes(evidence: DistributionEvidence): readonly {
  key: string
  mode: 't' | 'b'
  label: string
  icon: Component
  fact: ContentFact
}[] {
  return [
    {
      key: 'div_loss_t',
      mode: 't',
      label: MOBILITE_MODE_LABELS.walkTransit,
      icon: Footprints,
      fact: evidence.marks.walkTransit,
    },
    ...(evidence.marks.bike
      ? [
          {
            key: 'div_loss_b' as const,
            mode: 'b' as const,
            label: MOBILITE_MODE_LABELS.bike,
            icon: Bike,
            fact: evidence.marks.bike,
          },
        ]
      : []),
  ]
}

function hasAnyAccessValue(service: AccessEvidence['services'][number]): boolean {
  return Object.values(service.modes).some((mode) => mode.fact.value !== null)
}

function sourceLabel(source: { source: string; version: string }): string {
  const separator = source.source.indexOf(' — ')
  const shortSource = separator < 0 ? source.source : source.source.slice(0, separator)
  return `${shortSource} · ${source.version}`
}

const sourceLabels = computed(() => props.content.sourceRegister.map(sourceLabel))

useCahierBaselineGrid(rootRef, () => props.presentation !== 'plain')

onMounted(() => {
  scheduleMasonry()
  if (figureStackRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleMasonry())
    resizeObserver.observe(figureStackRef.value)
    sectionElements.forEach((element) => resizeObserver?.observe(element))
  }
  activeFigure.value = pageEntry.value?.anchor ?? anchorForEntry('acces-aux-services')
  if (!rootRef.value || !('IntersectionObserver' in window)) return
  const figures = [...rootRef.value.querySelectorAll<HTMLElement>('[data-figure]')]
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      const key = visible[0]?.target.getAttribute('data-figure')
      if (key) activeFigure.value = key
    },
    { rootMargin: '-14% 0px -66% 0px', threshold: [0, 0.25, 0.75] },
  )
  figures.forEach((figure) => observer?.observe(figure))
})

onBeforeUnmount(() => {
  observer?.disconnect()
  resizeObserver?.disconnect()
})

watch(() => props.content, scheduleMasonry, { deep: true })
</script>

<template>
  <article
    ref="rootRef"
    class="cahier"
    :class="{ 'cahier--sans-grille': props.presentation === 'plain' }"
    :style="{
      '--cahier-theme': 'var(--theme-mobilite-line)',
      '--cahier-theme-strong': 'var(--theme-mobilite-strong)',
      '--cahier-ground': 'var(--theme-mobilite-soft)',
      '--cahier-theme-emphasis': 'var(--theme-mobilite)',
      '--cahier-region-emphasis': 'var(--brand-200)',
      '--cahier-mode-foot': 'var(--mode-transit)',
      '--cahier-mode-bike': 'var(--mode-bike)',
      '--cahier-mode-car': 'var(--mode-car)',
    }"
  >
      <div class="cahier-reader">
      <aside class="cahier-spine" aria-label="Sommaire du cahier">
        <p class="spine-title">Sommaire</p>
        <ol>
          <li v-for="entry in pagination.entries" :key="entry.key">
            <a
              :href="`#${entry.anchor}`"
              :aria-current="activeFigure === entry.anchor ? 'location' : undefined"
            >
              <span class="spine-number">{{ entry.page === null ? '—' : String(entry.page).padStart(2, '0') }}</span>
              <span>{{ entry.label }}</span>
            </a>
          </li>
        </ol>
      </aside>

      <details class="mobile-index">
        <summary>Sommaire du cahier</summary>
        <nav aria-label="Sommaire du cahier">
          <a v-for="entry in pagination.entries" :key="entry.key" :href="`#${entry.anchor}`">
            <span class="spine-number">{{ entry.page === null ? '—' : String(entry.page).padStart(2, '0') }}</span>
            <span>{{ entry.label }}</span>
          </a>
        </nav>
      </details>

      <main class="cahier-pages">
        <section
          :id="pageEntry?.anchor ?? 'figure-lecture'"
          class="cahier-page"
          :data-figure="pageEntry?.anchor ?? 'figure-lecture'"
          :aria-labelledby="`${pageEntry?.anchor ?? 'figure-lecture'}-title`"
        >
          <div class="page-margin" aria-label="Informations marginales">
            <div class="page-number">
              <span>page</span>
              {{ String(pagination.currentPage).padStart(2, '0') }}<small>/{{ String(pagination.totalPages).padStart(2, '0') }}</small>
            </div>
            <div v-if="sourceLabels.length > 0" class="margin-sources">
              <span class="margin-label">Sources</span>
              <RouterLink v-for="source in sourceLabels" :key="source" to="/sources">{{ source }}</RouterLink>
            </div>
          </div>

          <header class="page-heading">
            <h2 class="cahier-baseline-anchor" :id="`${pageEntry?.anchor ?? 'figure-lecture'}-title`">{{ unit?.label }}</h2>
            <CahierProse class="page-subtitle" :blocks="content.introduction" />
          </header>

          <div
            ref="figureStackRef"
            class="figure-stack"
            :class="{ 'figure-stack--ready': masonryReady }"
            :style="{ minHeight: `${masonryHeight}px` }"
          >
            <section
              v-for="(section, sectionIndex) in sections"
              :key="section.key"
              :ref="(element) => setSectionElement(section.key, element)"
              class="concept-group"
              :data-section="section.key"
              :class="`cahier-section--${section.availability}`"
              :style="styleForSection(section.key)"
            >
              <div class="concept-group-heading cahier-baseline-group">
                <span>{{ String(sectionIndex + 1).padStart(2, '0') }}</span>
                <div
                  v-if="props.presentation === 'plain' && section.lecture"
                  class="concept-group-heading-copy"
                >
                  <span class="concept-group-label">{{ section.label }}</span>
                  <h3 class="concept-group-narrative">{{ section.lecture.marelle }}</h3>
                </div>
                <h3 v-else>{{ section.label }}</h3>
              </div>

              <section
                class="figure-spread"
                :class="{ 'figure-spread--flip': sectionIndex % 2 === 1 }"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <div class="argument-side">
                  <template v-if="section.lecture?.prose.length">
                    <h4
                      v-if="props.presentation !== 'plain' && section.lecture?.prose.length"
                      class="cahier-baseline-anchor cahier-marelle-anchor"
                    >{{ section.lecture.marelle }}</h4>
                    <CahierProse class="argument-copy" :blocks="section.lecture.prose" />
                    <div
                      v-if="props.presentation !== 'plain' && sectionExploration(section)"
                      class="cahier-section-exploration"
                      aria-label="Explorer les indicateurs de cette section"
                    >
                      <PassarelleExploration
                        :to="sectionExploration(section)!"
                        libelle="En savoir plus"
                        sans-soulignement
                        class="cahier-baseline-anchor"
                      />
                    </div>
                    <div v-if="section.evidence?.kind === 'distribution'" class="mode-figures">
                      <div class="mode-figures-heading type-figure-column" aria-hidden="true">
                        <span />
                        <span>Types de services perdus</span>
                      </div>
                      <dl>
                        <div
                          v-for="mode in diversityModes(section.evidence)"
                          :key="mode.key"
                          class="mode-figure"
                          :class="`mode-figure--${mode.mode}`"
                        >
                          <dt>
                            <component :is="mode.icon" :size="20" stroke-width="1.6" />
                            {{ mode.label }}
                          </dt>
                          <dd>
                    <strong class="mode-value cahier-scalar-value" :class="{ 'is-extreme': isExtreme(mode.fact.fact) }">
                              {{ formatFact(mode.fact.fact) }}
                            </strong>
                            <CahierReferenceNote
                              :fact="mode.fact.fact"
                              :reference-label="referenceLabelForFigure(section.evidence.referenceLabel)"
                               :to="sectionExploration(section)"
                            />
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </template>
                  <p v-else-if="section.availability !== 'complete'" class="cahier-section-state" role="note">{{ sectionState(section) }}</p>

                </div>

                <figure v-if="section.evidence?.kind === 'distribution'" class="evidence-side evidence-figure">
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">Distribution des bâtiments selon les services perdus</figcaption>
                  <DistributionFigureCahier
                    :evidence="section.evidence"
                    :nom="nomTerritoirePourAffichage(content.territory)"
                  />
                </figure>

                <figure v-else-if="section.evidence?.kind === 'summary'" class="evidence-side evidence-figure summary-evidence">
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">Équipements accessibles en 20 min., moyenne</figcaption>
                  <div class="cahier-figure-frame" :style="CAHIER_FIGURE_STYLE">
                  <template v-if="props.presentation === 'plain'">
                    <div class="summary-metrics summary-metrics--paired summary-bar-metrics">
                      <section
                        v-for="metric in summaryMetrics(section.evidence)"
                        :key="metric.key"
                        v-show="summaryHasValues(metric.values)"
                        class="summary-metric"
                      >
                        <h4 class="summary-metric-title type-figure-label">{{ summaryMetricTitle(metric.key) }}</h4>
                        <div class="summary-bar-pair">
                          <div class="summary-bar-row summary-bar-row--territory">
                            <div class="summary-bar-visual">
                              <div
                                class="summary-stack cahier-tooltip-trigger"
                                role="img"
                                tabindex="0"
                                :aria-describedby="summaryBarTooltipId(metric.key, false)"
                                 :aria-label="`${summaryMetricTitle(metric.key)}, territoire : ${summarySegments(metric.values, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes).map((segment) => `${segment.label} ${formatFactValue(segment.fact.fact, segment.value)}`).join('; ')}`"
                               >
                                <span
                                   v-for="segment in summarySegments(metric.values, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes)"
                                  :key="segment.mode"
                                  class="summary-stack-segment"
                                   :class="`summary-stack-segment--${summarySegmentClass(segment.mode)}`"
                                  :style="{ left: segment.left, right: segment.right }"
                                />
                              </div>
                              <CahierFigureTooltip
                                :id="summaryBarTooltipId(metric.key, false)"
                                class="summary-bar-tooltip"
                                title="Détail par mode"
                                 :rows="summaryTooltipRows(metric.values, false, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes)"
                                popover
                                compact
                              />
                            </div>
                          </div>
                          <div
                            v-if="summaryHasReference(metric.values)"
                            class="summary-bar-row summary-bar-row--reference"
                          >
                            <div class="summary-bar-visual">
                              <div
                                 class="summary-stack summary-stack--reference cahier-tooltip-trigger"
                                role="img"
                                tabindex="0"
                                :aria-describedby="summaryBarTooltipId(metric.key, true)"
                                   :aria-label="`${summaryMetricTitle(metric.key)}, ${referenceLabelForFigure(section.evidence.referenceLabel) ?? 'Référence indisponible'} : ${summaryBarSegments(metric.values, true, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes).map((segment) => `${segment.label} ${formatFactValue(segment.fact.fact, segment.value)}`).join('; ')}`"
                               >
                                <span
                                   v-for="segment in summaryBarSegments(metric.values, true, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes)"
                                  :key="segment.mode"
                                  class="summary-stack-segment"
                                   :class="`summary-stack-segment--${summarySegmentClass(segment.mode)}`"
                                  :style="{ left: segment.left, right: segment.right }"
                                />
                              </div>
                               <CahierFigureTooltip
                                 :id="summaryBarTooltipId(metric.key, true)"
                                 class="summary-bar-tooltip"
                                 title="Détail par mode"
                                 :rows="summaryTooltipRows(metric.values, true, metric.key, section.evidence.typeCount, section.evidence.inaccessibleTypes)"
                                 popover
                                 compact
                               />
                            </div>
                            <span class="summary-bar-label summary-bar-label--reference type-figure-label">{{ referenceLabelForFigure(section.evidence.referenceLabel) ?? 'Référence indisponible' }}</span>
                          </div>
                        </div>
                      </section>
                    </div>
                    <CahierFigureLegend
                      class="summary-mode-key"
                      :entries="section.evidence.legend"
                      :icons="MODE_ICONS"
                      label="Modes d’accès"
                    />
                    <div class="summary-metrics summary-metrics--paired summary-loss-metrics">
                      <section
                        v-for="metric in summaryMetrics(section.evidence)"
                        :key="metric.key"
                        v-show="summaryHasValues(metric.values)"
                        class="summary-metric"
                      >
                        <div class="summary-loss">
                          <span class="summary-loss-title type-figure-label">
                            {{ metric.key === 'equipment' ? 'Perte totale d’accès' : 'Perte de diversité' }}
                          </span>
                          <div class="summary-loss-readings">
                            <CahierFigureScalar
                              v-for="loss in summaryLosses(section.evidence, metric.key)"
                              :key="loss.mode"
                              class="summary-loss-reading"
                              :value="loss.fact.fact.value === null ? '—' : formatNumber(loss.fact.fact.value, 0)"
                              :label="loss.label"
                              :icon="modeIcon(loss.mode)"
                              :tone="MODE_CLASSES[loss.mode]"
                              color-value
                              :show-label="false"
                              :extreme="isExtreme(loss.fact.fact)"
                              :aria-label="`${loss.label} : ${loss.fact.fact.value === null ? 'indisponible' : formatNumber(loss.fact.fact.value, 0)}`"
                            >
                              <template #reference>
                                <CahierReferenceNote
                                  v-if="loss.fact.fact.comparison?.reference"
                                  :fact="loss.fact.fact"
                                  :reference-label="referenceLabelForFigure(section.evidence.referenceLabel)"
                                  :maximum-fraction-digits="0"
                                  :to="sectionExploration(section)!"
                                />
                              </template>
                            </CahierFigureScalar>
                          </div>
                        </div>
                      </section>
                    </div>
                  </template>
                  <div v-else class="summary-metrics">
                    <section
                      v-for="metric in summaryMetrics(section.evidence)"
                      :key="metric.key"
                      v-show="summaryHasValues(metric.values)"
                      class="summary-metric"
                    >
                      <h4 class="summary-metric-title">{{ metric.title }} <span>(moy./bât.)</span></h4>
                      <div
                        class="summary-stack"
                        role="img"
                        :aria-label="`${metric.title} : ${summarySegments(metric.values).map((segment) => `${segment.label} ${formatFact(segment.fact.fact)}`).join('; ')}`"
                      >
                        <span
                          v-for="segment in summarySegments(metric.values)"
                          :key="segment.mode"
                          class="summary-stack-segment"
                           :class="`summary-stack-segment--${summarySegmentClass(segment.mode)}`"
                          :style="{ left: segment.left, right: segment.right }"
                        />
                      </div>
                      <dl class="summary-values">
                        <div
                          v-for="segment in summarySegments(metric.values)"
                          :key="segment.mode"
                          class="summary-value"
                           :class="`summary-value--${summarySegmentClass(segment.mode)}`"
                        >
                          <dt>
                            <component :is="segment.icon" :size="16" stroke-width="1.6" aria-hidden="true" />
                            {{ segment.label }}
                          </dt>
                          <dd>
                            <strong class="cahier-scalar-value" :class="{ 'is-extreme': isExtreme(segment.fact.fact) }">{{ formatFact(segment.fact.fact) }}</strong>
                             <small v-if="summaryLossForSegment(metric.values, segment) !== null">
                               −{{ formatNumber(summaryLossForSegment(metric.values, segment)!) }} vs voiture
                            </small>
                            <CahierReferenceNote
                              :fact="segment.fact.fact"
                              :reference-label="referenceLabelForFigure(section.evidence.referenceLabel)"
                               :to="sectionExploration(section)"
                            />
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                  </div>
                </figure>

                <figure v-else-if="section.evidence?.kind === 'bpe-profiles'" class="evidence-side evidence-figure bpe-evidence">
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.label }}</figcaption>
                  <p v-if="section.evidence.totalTypes !== null" class="bpe-profile-total">
                    {{ formatNumber(section.evidence.totalTypes, 0) }} types d’équipement
                  </p>
                  <BpeProfilesChartCahier
                    :profiles="section.evidence.profiles"
                    :territory-name="section.evidence.territoryName"
                    :donut-tooltip-title="section.evidence.donutTooltipTitle"
                    :reference-label="section.evidence.referenceLabel"
                    :legend="section.evidence.legend"
                    :exploration-to="sectionExploration(section)"
                  />
                  <p v-if="section.evidence.referenceLabel" class="bpe-profile-reference-note" role="note">
                    *ref : {{ section.evidence.referenceLabel }}
                  </p>
                </figure>
                <figure v-else-if="section.evidence?.kind === 'access'" class="evidence-side access-figure-collection">
                   <figcaption class="cahier-figure-title cahier-baseline-anchor">Part des bâtiments qui ont accès à chaque type de service</figcaption>
                   <div class="cahier-figure-frame" :style="CAHIER_FIGURE_STYLE">
                   <div class="access-figures" aria-label="Part des bâtiments accessibles par service et par mode">
                    <figure
                      v-for="service in section.evidence.services"
                      :key="service.service"
                      class="access-figure"
                      :class="{ 'access-figure--incomplete': !hasAnyAccessValue(service) }"
                    >
                      <CahierDonut
                        class="stacked-donut cahier-tooltip-trigger"
                         :style="accessDonutStyle(service)"
                         :aria-describedby="accessTooltipId(service.service)"
                        :label-accessible="`${service.label}. ${[...Object.values(service.modes), service.inaccessible].map((mode) => `${mode.label} : ${formatFact(mode.fact)}`).join('; ')}`"
                      >
                        <component :is="serviceIcon(service.service)" class="stacked-donut-icon" :size="16" stroke-width="1.5" aria-hidden="true" />
                        <span>{{ service.label }}</span>
                      </CahierDonut>
                      <CahierFigureScalar
                        class="access-foot-summary"
                        :value="formatFact(service.modes.walkTransit.fact)"
                        :label="service.modes.walkTransit.label"
                        :icon="Footprints"
                        tone="t"
                        color-value
                        :show-label="false"
                        :extreme="isExtreme(service.modes.walkTransit.fact)"
                        :aria-label="`${service.label}. ${service.modes.walkTransit.label} : ${formatFact(service.modes.walkTransit.fact)}`"
                      >
                        <template #reference>
                          <CahierReferenceNote
                            :fact="service.modes.walkTransit.fact"
                            :reference-label="referenceLabelForFigure(section.evidence.referenceLabel)"
                             :to="sectionExploration(section)"
                          />
                        </template>
                      </CahierFigureScalar>
                       <CahierFigureTooltip
                         :id="accessTooltipId(service.service)"
                         class="access-tooltip"
                         title="Détail par mode"
                        :rows="accessTooltipRows(service, section.evidence.referenceLabel)"
                        popover
                      />
                    </figure>
                    <div class="access-legend">
                      <p>Chaque cercle montre les parts disponibles par mode.</p>
                      <CahierFigureLegend
                        :entries="section.evidence.legend"
                        :icons="MODE_ICONS"
                        label="Légende des parts d'accessibilité"
                      />
                    </div>
                     </div>
                   </div>
                 </figure>

                <div v-else class="evidence-side evidence-placeholder" role="note">
                  <span>{{ sectionState(section) }}</span>
                </div>
              </section>
              <div
                v-if="(props.presentation === 'plain' && sectionExploration(section)) || comparisonReference"
                class="cahier-section-footer"
              >
                <div
                  v-if="props.presentation === 'plain' && sectionExploration(section)"
                  class="cahier-section-exploration cahier-section-exploration--unit-footer"
                  aria-label="Explorer les indicateurs de cette section"
                >
                  <PassarelleExploration
                    :to="sectionExploration(section)!"
                    libelle="En savoir plus"
                    sans-soulignement
                    class="cahier-baseline-anchor"
                  />
                </div>
                <p v-if="comparisonReference" class="subgroup-reference" role="note">
                  *ref : médiane des {{ comparisonReference }}
                </p>
              </div>
            </section>
          </div>
        </section>

        <section
          :id="sourceEntry?.anchor ?? 'figure-sources'"
          class="sources-page"
          :data-figure="sourceEntry?.anchor ?? 'figure-sources'"
          aria-labelledby="sources-title"
        >
          <div class="page-margin" aria-hidden="true"><div class="page-number"><span>fin</span> ·</div></div>
          <header class="page-heading"><h2 id="sources-title">Carnet des sources</h2></header>
          <dl class="sources-list">
            <div v-for="source in content.sourceRegister" :key="source.id">
              <dt><RouterLink to="/sources">{{ source.source }}</RouterLink></dt>
              <dd>
                <span>Version {{ source.version }}</span>
                <span v-if="formatDate(source.referenceDate)"> · Référence {{ formatDate(source.referenceDate) }}</span>
                <span v-if="formatDate(source.publicationDate)"> · Publication {{ formatDate(source.publicationDate) }}</span>
              </dd>
            </div>
          </dl>
          <RouterLink class="sources-link" to="/sources">Voir toutes les sources</RouterLink>
        </section>
      </main>
    </div>
  </article>
</template>

<style scoped>
@font-face {
  font-family: 'Marelle';
  src: url('/fonts/Marelle-Regular.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}

.cahier {
  --paper: #f1f2ec;
  --paper-deep: #dfe5df;
  --ink: #232a2a;
  --muted: #62706c;
  --red: #a44f51;
  --red-soft: rgb(164 79 81 / 58%);
  --cahier-default: var(--muted);
  --cahier-profile-inaccessible: color-mix(in srgb, var(--cahier-default) 42%, var(--paper));
  --margin-line: 104px;
  --rule: color-mix(in srgb, var(--cahier-theme) 19%, transparent);
  --fine-rule: color-mix(in srgb, var(--cahier-theme) 8%, transparent);
  min-height: 0;
  color: var(--ink);
  background: transparent;
  font-family: var(--font-sans);
}

.cahier--sans-grille .cahier-page,
.cahier--sans-grille .sources-page {
  background-image: linear-gradient(
    to left,
    transparent 0,
    transparent var(--margin-line),
    var(--red-soft) var(--margin-line),
    var(--red-soft) calc(var(--margin-line) + 1px),
    transparent calc(var(--margin-line) + 1px)
  );
}

.cahier--sans-grille {
  --cahier-grid-jump: 24px;
  --cahier-prose-line-height: 1.45;
  --cahier-prose-paragraph-gap: var(--space-3);
  --cahier-group-gap: var(--space-6);
  --cahier-figure-title-gap: var(--space-3);
  --cahier-figure-title-min-height: 0px;
  --cahier-page-left-inset: 64px;
  --cahier-page-right-inset: 148px;
  --cahier-spread-gap: var(--space-5);
  --cahier-spread-padding: 0px;
  --cahier-unit-padding: var(--space-3);
}

.cahier-page,
.sources-page {
  background-color: var(--paper);
  background-image:
    linear-gradient(to right, transparent 0, transparent var(--margin-line), var(--red-soft) var(--margin-line), var(--red-soft) calc(var(--margin-line) + 1px), transparent calc(var(--margin-line) + 1px)),
    repeating-linear-gradient(to bottom, transparent 0 7px, var(--fine-rule) 7px 8px, transparent 8px 15px, var(--fine-rule) 15px 16px, transparent 16px 23px, var(--fine-rule) 23px 24px, transparent 24px 30px, var(--rule) 30px 32px);
}

.cahier-reader { display: grid; grid-template-columns: minmax(160px, 210px) minmax(0, 1fr); gap: clamp(28px, 4vw, 68px); max-width: 1640px; margin: 0 auto; padding: 0 0 64px; }
.cahier-spine { position: sticky; top: 24px; align-self: start; padding-top: 4px; }
.spine-title, .margin-label { margin: 0; color: var(--cahier-theme-strong); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.cahier-spine ol { display: grid; gap: 6px; margin: 18px 0 0; padding: 0; list-style: none; }
.cahier-spine a { display: grid; grid-template-columns: 28px 1fr; gap: 8px; padding: 7px 0; color: var(--muted); font-size: 13px; line-height: 1.3; text-decoration: none; }
.cahier-spine a > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.cahier-spine a:hover, .cahier-spine a[aria-current='location'] { color: var(--ink); }
.cahier-spine a[aria-current='location'] .spine-number { color: var(--red); }
.spine-number { color: var(--cahier-theme-strong); font-variant-numeric: tabular-nums; }
.mobile-index { display: none; }
.cahier-pages { display: grid; gap: 96px; min-width: 0; }
.cahier-page, .sources-page { container: cahier-page / inline-size; position: relative; min-width: 0; --page-left-inset: var(--cahier-page-left-inset, 148px); --page-right-inset: var(--cahier-page-right-inset, 64px); padding: 48px var(--page-right-inset) 56px var(--page-left-inset); border: 1px solid rgb(35 42 42 / 15%); box-shadow: 0 14px 30px rgb(67 57 42 / 11%); scroll-margin-top: 28px; }
.page-margin { position: absolute; top: 48px; left: 18px; display: grid; width: 72px; gap: 30px; align-content: start; text-align: center; }
.cahier--sans-grille .page-margin { right: 18px; left: auto; }
.page-number { display: grid; gap: 3px; color: var(--red); font-family: var(--font-serif); font-size: 29px; line-height: .9; }
.page-number span, .page-number small { color: var(--muted); font-family: var(--font-sans); font-size: 9px; }
.page-number span { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.margin-sources { display: grid; gap: 10px; justify-items: center; overflow-wrap: anywhere; }
.margin-sources a { color: var(--cahier-theme-strong); font-size: 10px; line-height: 1.1; text-decoration-thickness: 1px; text-underline-offset: 3px; word-break: break-word; }
.page-heading { padding-right: calc(var(--page-left-inset) - var(--page-right-inset)); padding-bottom: 18px; }
.cahier--sans-grille .page-heading { padding-right: 0; padding-left: 0; }
.page-heading h2 { max-width: none; margin: 0; color: var(--ink); font-family: var(--font-serif); font-size: clamp(1.65rem, 2.8vw, 2.4rem); font-weight: 400; letter-spacing: -.035em; line-height: 1; text-align: center; }
.page-subtitle { max-width: none; margin: 14px 0 0; color: var(--cahier-default); font-size: 15px; text-align: justify; }
.figure-stack {
  --masonry-gap: var(--space-8);
  --masonry-half-gap: calc(var(--masonry-gap) / 2);
  position: relative;
  min-width: 0;
}
.cahier--sans-grille .figure-stack {
  --masonry-gap: var(--space-4);
}
.concept-group {
  container: subgroup / inline-size;
  margin: 0 0 var(--cahier-group-gap, var(--space-8));
}
.cahier--sans-grille .concept-group {
  padding: var(--cahier-unit-padding);
  border: 1px solid color-mix(in srgb, var(--cahier-theme) 24%, var(--paper));
  background: transparent;
}
.figure-stack:not(.figure-stack--ready) .concept-group { width: 100%; }
.figure-stack--ready .concept-group {
  position: absolute;
  top: var(--masonry-top);
  left: var(--masonry-left);
  width: var(--masonry-width);
}
.concept-group-heading { display: flex; align-items: baseline; justify-content: center; gap: 14px; padding: var(--cahier-unit-heading-padding, 8px 0 14px); }
.cahier--sans-grille .concept-group-heading { --cahier-unit-heading-padding: 0 0 var(--space-2); }
.concept-group-heading-copy { display: grid; gap: 4px; min-width: 0; text-align: center; }
.concept-group-label { color: var(--cahier-theme-strong); font-size: 10px; font-weight: 700; letter-spacing: .08em; line-height: 1.2; text-transform: uppercase; }
.concept-group-heading > span { color: var(--red); font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: .08em; }
.concept-group-heading h3 { margin: 0; color: var(--ink); font-family: var(--font-serif); font-size: calc(1.2rem + 2px); font-weight: 500; line-height: 1; }
.cahier--sans-grille .concept-group-narrative { font-size: clamp(1.05rem, 1.4vw, 1.35rem); font-style: italic; font-weight: 400; line-height: 1.15; text-wrap: balance; }
.figure-spread { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(420px, 1.2fr); column-gap: clamp(40px, 5vw, 76px); row-gap: var(--cahier-spread-gap, 34px); align-items: start; padding: var(--cahier-spread-padding, 22px) 0; }
.figure-spread--flip .argument-side { order: 2; }
.figure-spread--flip .evidence-side { order: 1; }
.argument-side, .evidence-side { min-width: 0; }
.argument-side { --mode-scalar-width: 160px; }
.argument-side h4 { margin: 0; color: var(--cahier-theme-emphasis); font-family: 'Marelle', var(--font-serif); font-size: clamp(calc(1rem + 2px), calc(1.35vw + 2px), calc(1.25rem + 2px)); font-weight: 500; line-height: var(--cahier-grid-jump); }
.argument-copy { width: 100%; margin: var(--cahier-grid-jump) 0 0; color: var(--cahier-default); font-size: 15px; text-align: justify; }
.cahier-section-state, .evidence-placeholder { color: var(--cahier-default); font-size: 14px; line-height: 1.5; }
.cahier-section-state { margin: 0; padding: 20px 0; }
.evidence-placeholder { display: grid; place-items: center; min-height: 180px; border: 1px dashed color-mix(in srgb, var(--cahier-theme) 35%, transparent); text-align: center; }
.evidence-figure { margin: 0; padding: 12px 0 0; }
.cahier--sans-grille .evidence-figure { padding-top: 0; }
.summary-evidence { display: grid; gap: 10px; }
.summary-evidence .cahier-figure-title { margin-bottom: 0; }
.cahier--sans-grille .summary-metrics--paired {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 10%;
}
.cahier--sans-grille .summary-metric-title {
  color: var(--cahier-default);
  font: var(--type-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  line-height: 1.2;
  text-align: center;
  text-transform: uppercase;
}
.cahier--sans-grille .summary-metrics--paired .summary-stack { margin: 8px 0 0; }
.summary-bar-pair { display: grid; gap: 8px; margin-top: 8px; }
.summary-bar-row { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px; align-items: center; }
.summary-bar-label { display: block; margin-top: 4px; color: var(--cahier-default); font-size: 9px; line-height: 1.1; text-align: center; white-space: nowrap; }
.summary-bar-label--reference { color: var(--cahier-region-emphasis); }
.summary-bar-row--territory { display: block; }
.summary-bar-row--reference { grid-template-columns: 1fr; gap: 5px; }
.summary-bar-row--reference .summary-bar-label { display: block; text-align: center; }
.summary-bar-visual { position: relative; }
.summary-stack--reference { border: 1px solid color-mix(in srgb, var(--cahier-default) 24%, transparent); background: transparent; }
.summary-stack--reference .summary-stack-segment { opacity: .48; }
.cahier-tooltip-trigger { cursor: help; }
.summary-stack[tabindex]:focus-visible { outline: 2px solid var(--cahier-region-emphasis); outline-offset: 4px; }
.summary-mode-key { --cahier-figure-legend-margin: 4px 0 0; }
.summary-bar-metrics { gap: var(--space-6); }
.summary-loss-metrics { margin-top: var(--space-3); }
.summary-metrics { display: grid; gap: 42px; }
.summary-metric { min-width: 0; }
.summary-metric-title { margin: 0; color: var(--ink); font-family: var(--font-serif); font-size: 20px; font-weight: 500; line-height: 1.15; }
.summary-metric-title span { color: var(--cahier-default); font-family: var(--font-sans); font-size: 11px; font-weight: 500; white-space: nowrap; }
.summary-stack { position: relative; height: 14px; margin: 24px 0 20px; background: var(--paper-deep); }
.summary-stack-segment { position: absolute; top: 0; height: 100%; }
.summary-stack-segment--t { background: var(--cahier-mode-foot); }
.summary-stack-segment--b { background: var(--cahier-mode-bike); }
.summary-stack-segment--c { background: var(--cahier-mode-car); }
.summary-stack-segment--inaccessible {
  border-left: 1px solid color-mix(in srgb, var(--cahier-default) 54%, transparent);
  background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--cahier-default) 32%, transparent) 0 1px, transparent 1px 5px);
}
.summary-values { display: grid; gap: 14px; margin: 0; }
.summary-value { display: grid; grid-template-columns: minmax(140px, .8fr) minmax(0, 1.2fr); gap: 14px; align-items: start; padding-top: 12px; border-top: 1px solid var(--fine-rule); }
.summary-value dt { display: flex; align-items: center; gap: 7px; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.25; }
.summary-value dd { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; margin: 0; }
.summary-value dd strong { font: var(--type-figure-value); font-size: 18px; font-variant-numeric: tabular-nums; }
.summary-value dd small { color: var(--cahier-default); font-size: 11px; }
.summary-value dd .cahier-reference-note { grid-column: 1 / -1; text-align: left; }
.cahier--sans-grille .summary-value dd .cahier-reference-note { text-align: center; }
.cahier--sans-grille .summary-metric > .summary-loss { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }
.summary-loss { min-width: 0; }
.summary-loss-title { display: block; color: var(--cahier-default); text-align: center; }
.summary-loss-readings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.summary-value--t dt, .summary-value--t dd strong { color: var(--cahier-mode-foot); }
.summary-value--b dt, .summary-value--b dd strong { color: var(--cahier-mode-bike); }
.summary-value--c dt, .summary-value--c dd strong { color: var(--cahier-mode-car); }
.mode-figures { display: grid; gap: 0; margin: 16px 0 0; }
.mode-figures-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--mode-scalar-width); gap: 12px; color: var(--cahier-default); text-align: center; }
.mode-figure { padding: 14px 0 34px; }
.mode-figure-scalar { width: 100%; }

.mode-value.is-extreme, .bar-cell strong.is-extreme { text-decoration: underline; text-decoration-color: var(--red); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.cahier--sans-grille .cahier-scalar-value.is-extreme { text-decoration: underline; text-decoration-color: var(--red); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.regional-reading { font: var(--type-figure-mode); font-size: 11px; line-height: 1.25; }

.access-figure-collection { margin: 0; padding: 12px 0 0; }
.access-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 18px; align-items: start; }
.access-figure { position: relative; display: grid; min-width: 0; gap: 8px; justify-items: center; margin: 0; }
.access-legend { display: grid; gap: 7px; justify-items: center; margin-top: var(--space-5); color: var(--cahier-default); text-align: center; }
.access-legend p { margin: 0 0 3px; }

.bpe-evidence { min-width: 0; }
.bpe-profile-total { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); text-align: center; }
.bpe-profile-reference-note { margin: 8px 0 12px; color: var(--cahier-default); font: var(--type-figure-label); font-size: 11px; line-height: 1.3; text-align: center; }

.sources-page { padding-bottom: 72px; }
.sources-list { display: grid; gap: 18px; margin: 48px 0 0; }
.sources-list dt { color: var(--ink); font-size: 14px; font-weight: 700; }
.sources-list dt a { color: inherit; }
.sources-list dd { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
.sources-link { display: inline-block; margin-top: 48px; color: var(--cahier-theme-strong); font-size: 13px; text-underline-offset: 4px; }
.cahier--sans-grille .cahier-section-exploration--unit-footer { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }
.cahier-section-footer { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-3); }
.cahier--sans-grille .cahier-section-footer { padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }
.cahier--sans-grille .cahier-section-exploration--unit-footer { margin-top: 0; padding-top: 0; border-top: 0; }
.subgroup-reference { margin: 0 0 0 auto; color: var(--cahier-region-emphasis); font: var(--type-figure-label); letter-spacing: .04em; line-height: 1.2; text-align: right; text-transform: none; }

/* A subgroup occupies one independent masonry rail. Its existing figure spread
   remains intact, but collapses only when the rail cannot physically hold both
   sides without overflow. */
@container subgroup (max-width: 760px) {
  .figure-spread { grid-template-columns: 1fr; column-gap: 0; row-gap: var(--cahier-spread-gap, 24px); }
  .figure-spread--flip .argument-side, .figure-spread--flip .evidence-side { order: initial; }
}

@container cahier-page (max-width: 900px) {
  .figure-spread { grid-template-columns: 1fr; gap: var(--cahier-spread-gap, 32px); }
  .figure-spread--flip .argument-side, .figure-spread--flip .evidence-side { order: initial; }
  .summary-metrics { gap: 32px; }
}
@container cahier-page (max-width: 620px) {
  .access-figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cahier--sans-grille .summary-metrics--paired { grid-template-columns: 1fr; gap: var(--space-6); }
}
@container cahier-page (max-width: 480px) {
  .summary-value { grid-template-columns: 1fr; gap: 5px; }
  .summary-value dd .cahier-reference-note { text-align: left; }
  .cahier--sans-grille .summary-value dd .cahier-reference-note { text-align: center; }
}

@media (max-width: 760px) {
  .cahier--sans-grille { --cahier-page-left-inset: 28px; --cahier-page-right-inset: 116px; }
  .cahier { --margin-line: 82px; }
  .cahier-reader { grid-template-columns: 1fr; padding-top: 36px; }
  .cahier-spine { display: none; }
  .mobile-index { display: block; padding: 0 24px; border-bottom: 1px solid var(--red-soft); background: var(--paper); }
  .mobile-index summary { padding: 17px 0; color: var(--cahier-theme-strong); cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .mobile-index nav { display: grid; gap: 2px; padding: 0 0 18px 18px; }
  .mobile-index a { display: flex; gap: 12px; padding: 8px 0; color: var(--muted); font-size: 14px; text-decoration: none; }
  .page-margin { width: 58px; }
  .cahier--sans-grille .page-margin { right: 10px; left: auto; }
  .cahier-page, .sources-page { --page-left-inset: 116px; --page-right-inset: 28px; padding-right: var(--page-right-inset); padding-left: var(--page-left-inset); }
}
@media (max-width: 600px) {
  .cahier--sans-grille { --cahier-page-left-inset: 18px; --cahier-page-right-inset: 96px; }
  .cahier { --margin-line: 74px; }
  .cahier-cover { padding: 18px 20px 44px; }
  .cahier-local-nav { padding-left: 44px; font-size: 10px; }
  .cahier-home-link { display: none; }
  .cover-body { margin-top: 76px; padding-left: 44px; }
  .cover-body h1 { font-size: clamp(3.5rem, 20vw, 6rem); }
  .cover-lead { font-size: 18px; }
  .cover-signature { margin-top: 48px; font-size: 9px; }
  .cover-bottom-rule { margin-top: 52px; }
  .cahier-reader { padding: 48px 20px 88px; }
  .cahier-pages { gap: 64px; }
  .cahier-page, .sources-page { --page-left-inset: 96px; --page-right-inset: 18px; padding: 36px var(--page-right-inset) 40px var(--page-left-inset); }
  .page-margin { top: 36px; left: 10px; width: 48px; }
  .page-number { font-size: 24px; }
  .page-heading h2 { font-size: clamp(1.35rem, 7vw, 1.85rem); }
  .figure-spread { padding: var(--cahier-spread-padding, 28px) 0; }
  .access-figures { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .cahier * { scroll-behavior: auto !important; }
}
</style>
