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
  BpeProfilesEvidence,
  ContentFact,
  ContentSection,
  DistributionEvidence,
  ExplorationTarget,
  SummaryEvidence,
  ThemeContent,
} from '@/fiche/content/themeContent'
import {
  routePourCibleExploration,
  routePourFaitExploration,
  routePourSectionExploration,
} from '@/fiche/explorationHandoff'
import {
  MOBILITE_MODE_LABELS,
  nomTerritoirePourAffichage,
} from '@/fiche/content/territoryFacts'
import type { MobiliteAccessMode, MobiliteService, NumericFact } from '@/fiche/content/territoryFacts'
import { layoutMasonry } from '@/fiche/masonryLayout'
import type { CahierPagination } from './cahierPagination'
import CahierProse from './CahierProse.vue'
import CahierReferenceNote from './CahierReferenceNote.vue'
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

function profileCountLabel(count: number): string {
  return `${count} type${count > 1 ? 's' : ''}`
}

function formatPercentage(value: number): string {
  return `${formatNumber(value * 100, 0)} %`
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

function summaryHasValues(values: SummaryEvidence['accessibleEquipment']): boolean {
  return Object.values(values).some((value) => value.fact.value !== null)
}

function summaryScale(values: SummaryEvidence['accessibleEquipment']): number {
  return Math.max(
    0,
    ...Object.values(values).flatMap((value) => [
      value.fact.value ?? 0,
      value.fact.comparison?.reference?.value ?? 0,
    ]),
  )
}

function summarySegments(values: SummaryEvidence['accessibleEquipment']): readonly {
  mode: MobiliteAccessMode
  label: string
  icon: Component
  fact: ContentFact
  start: number
  end: number
  width: string
  left: string
}[] {
  const scale = summaryScale(values)
  const walk = Math.max(0, values.walkTransit.fact.value ?? 0)
  const bike = Math.max(walk, values.bike.fact.value ?? 0)
  const car = Math.max(bike, values.car.fact.value ?? 0)
  const segments = [
    { mode: 'walkTransit' as const, start: 0, end: walk, fact: values.walkTransit },
    { mode: 'bike' as const, start: walk, end: bike, fact: values.bike },
    { mode: 'car' as const, start: bike, end: car, fact: values.car },
  ]
  return segments.map((segment) => ({
    ...segment,
    label: MOBILITE_MODE_LABELS[segment.mode],
    icon: modeIcon(segment.mode),
    width: scale > 0 ? `${((segment.end - segment.start) / scale) * 100}%` : '0%',
    left: scale > 0 ? `${(segment.start / scale) * 100}%` : '0%',
  }))
}

function summaryLoss(values: SummaryEvidence['accessibleEquipment'], mode: MobiliteAccessMode): number | null {
  const car = values.car.fact.value
  const current = values[mode].fact.value
  return car === null || current === null || mode === 'car' ? null : Math.max(0, car - current)
}

function bpeProfileScale(profiles: BpeProfilesEvidence['profiles']): number {
  return Math.max(0, ...profiles.map((profile) => profile.count))
}

function bpeBarHeight(count: number, maximum: number): string {
  return maximum > 0 ? `${(count / maximum) * 100}%` : '0%'
}

function donutStyle(values: { car: number; bike: number; walkTransit: number }): Record<string, string> {
  const walk = Math.max(0, Math.min(1, values.walkTransit))
  const bike = Math.max(walk, Math.min(1, values.bike))
  const car = Math.max(bike, Math.min(1, values.car))
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

function routeForFact(section: ContentSection, fact: NumericFact) {
  const target = section.explorationTargets.find((candidate) => candidate.key === fact.key)
  return target
    ? routePourCibleExploration(target)
    : routePourFaitExploration(fact.key, fact.detail, props.content.territory)
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
                              :reference-label="section.evidence.referenceLabel"
                              :to="routeForFact(section, mode.fact.fact)"
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
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">Accès moyen par bâtiment</figcaption>
                  <div class="summary-metrics">
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
                          :class="`summary-stack-segment--${MODE_CLASSES[segment.mode]}`"
                          :style="{ left: segment.left, width: segment.width }"
                        />
                      </div>
                      <dl class="summary-values">
                        <div
                          v-for="segment in summarySegments(metric.values)"
                          :key="segment.mode"
                          class="summary-value"
                          :class="`summary-value--${MODE_CLASSES[segment.mode]}`"
                        >
                          <dt>
                            <component :is="segment.icon" :size="16" stroke-width="1.6" aria-hidden="true" />
                            {{ segment.label }}
                          </dt>
                          <dd>
                            <strong class="cahier-scalar-value" :class="{ 'is-extreme': isExtreme(segment.fact.fact) }">{{ formatFact(segment.fact.fact) }}</strong>
                            <small v-if="summaryLoss(metric.values, segment.mode) !== null">
                              −{{ formatNumber(summaryLoss(metric.values, segment.mode)!) }} vs voiture
                            </small>
                            <CahierReferenceNote
                              :fact="segment.fact.fact"
                              :reference-label="section.evidence.referenceLabel"
                              :to="routeForFact(section, segment.fact.fact)"
                            />
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </figure>

                <figure v-else-if="section.evidence?.kind === 'bpe-profiles'" class="evidence-side evidence-figure bpe-evidence">
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">Composition des profils d’accès</figcaption>
                  <div class="bpe-profile-chart" aria-label="Composition des profils d’accès par mode">
                    <div
                      v-for="profile in section.evidence.profiles"
                      :key="profile.profile"
                      class="bpe-profile-column"
                    >
                      <div class="bpe-profile-bar-area">
                        <span
                          class="bpe-profile-bar"
                          :style="{ height: bpeBarHeight(profile.count, bpeProfileScale(section.evidence.profiles)) }"
                        />
                      </div>
                      <strong class="bpe-profile-label">{{ profile.label }}</strong>
                      <span class="bpe-profile-count">{{ profileCountLabel(profile.count) }}</span>
                      <div
                        class="stacked-donut bpe-profile-donut"
                        :style="donutStyle(profile.exemplar)"
                        :aria-label="`${profile.exemplar.label}. ${MOBILITE_MODE_LABELS.walkTransit} : ${formatPercentage(profile.exemplar.walkTransit)}; ${MOBILITE_MODE_LABELS.bike} : ${formatPercentage(profile.exemplar.bike)}; ${MOBILITE_MODE_LABELS.car} : ${formatPercentage(profile.exemplar.car)}`"
                        role="img"
                      >
                        <span class="stacked-donut-center">
                          <span>Exemple</span>
                        </span>
                      </div>
                      <span class="bpe-profile-exemplar">{{ profile.exemplar.label }}</span>
                    </div>
                  </div>
                </figure>
                <figure v-else-if="section.evidence?.kind === 'access'" class="evidence-side access-figure-collection">
                  <figcaption class="cahier-figure-title cahier-baseline-anchor">Part des bâtiments qui ont accès à chaque type de service</figcaption>
                  <div class="access-figures" aria-label="Part des bâtiments accessibles par service et par mode">
                    <figure
                      v-for="service in section.evidence.services"
                      :key="service.service"
                      class="access-figure"
                      :class="{ 'access-figure--incomplete': !hasAnyAccessValue(service) }"
                    >
                      <div
                        class="stacked-donut"
                        :style="accessDonutStyle(service)"
                        :aria-label="`${service.label}. ${Object.values(service.modes).map((mode) => `${mode.label} : ${formatFact(mode.fact)}`).join('; ')}`"
                        role="img"
                        tabindex="0"
                      >
                        <span class="stacked-donut-center">
                          <component :is="serviceIcon(service.service)" class="stacked-donut-icon" :size="16" stroke-width="1.5" aria-hidden="true" />
                          <span>{{ service.label }}</span>
                        </span>
                      </div>
                      <div class="access-foot-summary">
                        <strong class="cahier-scalar-value" :class="{ 'is-extreme': isExtreme(service.modes.walkTransit.fact) }">
                          {{ formatFact(service.modes.walkTransit.fact) }}
                        </strong>
                        <span><Footprints class="cahier-mode-icon--foot" :size="14" stroke-width="1.7" aria-hidden="true" />{{ service.modes.walkTransit.label }}</span>
                        <CahierReferenceNote
                          :fact="service.modes.walkTransit.fact"
                          :reference-label="section.evidence.referenceLabel"
                          :to="routeForFact(section, service.modes.walkTransit.fact)"
                        />
                      </div>
                      <div class="access-tooltip" role="tooltip">
                        <strong>Détail par mode</strong>
                        <dl>
                          <div v-for="(mode, modeKey) in service.modes" :key="modeKey" :class="`access-detail--${MODE_CLASSES[modeKey as MobiliteAccessMode]}`">
                            <dt><component :is="modeIcon(modeKey as MobiliteAccessMode)" :size="12" stroke-width="1.7" />{{ mode.label }}</dt>
                            <dd>{{ formatFact(mode.fact) }}</dd>
                            <small v-if="mode.fact.comparison?.reference">
                              {{ section.evidence.referenceLabel ?? 'Référence' }} : {{ referenceFactText(mode.fact) }}
                            </small>
                          </div>
                        </dl>
                      </div>
                    </figure>
                    <div class="access-legend" aria-label="Légende des parts d'accessibilité">
                      <p>Chaque cercle montre les parts disponibles par mode.</p>
                      <span class="access-legend-item access-legend-item--t"><i />{{ MOBILITE_MODE_LABELS.walkTransit }}</span>
                      <span class="access-legend-item access-legend-item--b"><i />{{ MOBILITE_MODE_LABELS.bike }}</span>
                      <span class="access-legend-item access-legend-item--c"><i />{{ MOBILITE_MODE_LABELS.car }}</span>
                    </div>
                  </div>
                </figure>

                <div v-else class="evidence-side evidence-placeholder" role="note">
                  <span>{{ sectionState(section) }}</span>
                </div>
              </section>
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
.summary-evidence { display: grid; gap: 36px; }
.summary-metrics { display: grid; gap: 42px; }
.summary-metric { min-width: 0; }
.summary-metric-title { margin: 0; color: var(--ink); font-family: var(--font-serif); font-size: 20px; font-weight: 500; line-height: 1.15; }
.summary-metric-title span { color: var(--cahier-default); font-family: var(--font-sans); font-size: 11px; font-weight: 500; white-space: nowrap; }
.summary-stack { position: relative; height: 14px; margin: 24px 0 20px; background: var(--paper-deep); }
.summary-stack-segment { position: absolute; top: 0; height: 100%; }
.summary-stack-segment--t { background: var(--cahier-mode-foot); }
.summary-stack-segment--b { background: var(--cahier-mode-bike); }
.summary-stack-segment--c { background: var(--cahier-mode-car); }
.summary-values { display: grid; gap: 14px; margin: 0; }
.summary-value { display: grid; grid-template-columns: minmax(140px, .8fr) minmax(0, 1.2fr); gap: 14px; align-items: start; padding-top: 12px; border-top: 1px solid var(--fine-rule); }
.summary-value dt { display: flex; align-items: center; gap: 7px; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.25; }
.summary-value dd { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; margin: 0; }
.summary-value dd strong { font: var(--type-figure-value); font-size: 18px; font-variant-numeric: tabular-nums; }
.summary-value dd small { color: var(--cahier-default); font-size: 11px; }
.summary-value dd .cahier-reference-note { grid-column: 1 / -1; text-align: left; }
.cahier--sans-grille .summary-value dd .cahier-reference-note { text-align: center; }
.summary-value--t dt, .summary-value--t dd strong { color: var(--cahier-mode-foot); }
.summary-value--b dt, .summary-value--b dd strong { color: var(--cahier-mode-bike); }
.summary-value--c dt, .summary-value--c dd strong { color: var(--cahier-mode-car); }
.mode-figures { display: grid; gap: 0; margin: 16px 0 0; }
.mode-figures-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--mode-scalar-width); gap: 12px; color: var(--cahier-default); text-align: center; }
.mode-figure { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 0 34px; }
.mode-figure dt { display: flex; align-items: center; gap: 9px; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.3; }
.mode-figure dt svg { flex: 0 0 auto; }
.mode-figure--t dt svg, .mode-figure--t .mode-value { color: var(--cahier-mode-foot); }
.mode-figure--b dt svg, .mode-figure--b .mode-value { color: var(--cahier-mode-bike); }
.mode-figure dd { position: relative; width: var(--mode-scalar-width); min-width: 0; margin: 0; color: var(--cahier-default); font: var(--type-figure-value); font-size: 27px; text-align: center; }
.mode-value { display: block; }
.mode-figure dd small { display: block; margin-top: 9px; color: var(--cahier-default); font-family: var(--font-sans); font-size: 11px; line-height: 1.2; text-transform: uppercase; }
.mode-figure dd .cahier-reference-note { position: absolute; top: calc(100% + 8px); left: 0; width: 100%; }

.mode-value.is-extreme, .bar-cell strong.is-extreme, .access-foot-summary > strong.is-extreme { text-decoration: underline; text-decoration-color: var(--red); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.cahier--sans-grille .cahier-scalar-value.is-extreme { text-decoration: underline; text-decoration-color: var(--red); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.regional-reading { font: var(--type-figure-mode); font-size: 11px; line-height: 1.25; }

.access-figure-collection { margin: 0; padding: 12px 0 0; }
.access-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 18px; align-items: start; }
.access-figure { position: relative; display: grid; min-width: 0; gap: 8px; justify-items: center; margin: 0; }
.stacked-donut { position: relative; width: clamp(92px, 12vw, 132px); aspect-ratio: 1; margin: 0 auto; border-radius: 50%; background: conic-gradient(var(--cahier-mode-foot) 0 var(--donut-walk), var(--cahier-mode-bike) var(--donut-walk) var(--donut-bike), var(--cahier-mode-car) var(--donut-bike) var(--donut-car), var(--paper-deep) var(--donut-car) 360deg); }
.stacked-donut::after { position: absolute; inset: 10%; z-index: 1; border-radius: 50%; background: var(--paper); content: ''; }
.stacked-donut:focus-visible { outline: 2px solid var(--cahier-region-emphasis); outline-offset: 5px; }
.stacked-donut-center { position: absolute; inset: 16%; z-index: 2; display: grid; align-content: center; justify-items: center; gap: 4px; color: var(--cahier-default); font-size: 11px; line-height: 1.1; text-align: center; }
.access-foot-summary { display: grid; width: 100%; gap: 4px; justify-items: center; color: var(--cahier-mode-foot); text-align: center; }
.access-foot-summary > strong { font: var(--type-figure-value); font-variant-numeric: tabular-nums; }
.access-foot-summary > span { display: inline-flex; align-items: center; gap: 5px; color: var(--cahier-default); font-size: 10px; line-height: 1.1; }
.access-foot-summary > small { color: var(--cahier-region-emphasis); font-size: 10px; line-height: 1.25; }
.access-tooltip { position: absolute; top: calc(100% + 8px); left: 50%; z-index: 10; width: min(220px, calc(100% + 80px)); padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--cahier-theme-emphasis) 30%, transparent); background: var(--paper); box-shadow: 0 12px 28px rgb(35 42 42 / 16%); color: var(--cahier-default); font-size: 11px; line-height: 1.25; opacity: 0; pointer-events: none; transform: translate(-50%, -4px); visibility: hidden; }
.stacked-donut:hover ~ .access-tooltip, .stacked-donut:focus-visible ~ .access-tooltip { opacity: 1; transform: translate(-50%, 0); visibility: visible; }
.access-tooltip > strong { color: var(--cahier-region-emphasis); }
.access-tooltip dl { display: grid; gap: 7px; margin: 8px 0 0; }
.access-tooltip dl > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; }
.access-tooltip dt { display: flex; align-items: center; gap: 5px; }
.access-tooltip dd { margin: 0; font-variant-numeric: tabular-nums; }
.access-tooltip small { grid-column: 1 / -1; color: var(--cahier-region-emphasis); font-size: 10px; }
.access-legend { grid-column: 3; grid-row: 2; align-self: center; display: grid; gap: 7px; justify-items: center; padding: 10px 0; color: var(--cahier-default); font-size: 11px; text-align: center; }
.access-legend p { margin: 0 0 3px; }
.access-legend-item { display: flex; align-items: center; justify-content: center; gap: 7px; }
.access-legend-item i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.access-legend-item--t i { background: var(--cahier-mode-foot); }
.access-legend-item--b i { background: var(--cahier-mode-bike); }
.access-legend-item--c i { background: var(--cahier-mode-car); }

.bpe-evidence { min-width: 0; }
.bpe-profile-chart { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(18px, 3vw, 34px); align-items: end; }
.bpe-profile-column { display: grid; gap: 8px; min-width: 0; justify-items: center; text-align: center; }
.bpe-profile-bar-area { display: flex; width: 100%; height: 170px; align-items: end; justify-content: center; border-bottom: 1px solid var(--rule); }
.bpe-profile-bar { display: block; width: min(72px, 48%); min-height: 4px; background: var(--cahier-theme); }
.bpe-profile-label { color: var(--ink); font-size: 12px; line-height: 1.25; }
.bpe-profile-count { color: var(--cahier-theme-strong); font-size: 10px; font-weight: 700; letter-spacing: .08em; line-height: 1.2; text-transform: uppercase; }
.bpe-profile-donut { width: clamp(76px, 10vw, 108px); margin-top: 10px; }
.bpe-profile-exemplar { max-width: 16ch; color: var(--cahier-default); font-size: 11px; line-height: 1.2; overflow-wrap: anywhere; }

.sources-page { padding-bottom: 72px; }
.sources-list { display: grid; gap: 18px; margin: 48px 0 0; }
.sources-list dt { color: var(--ink); font-size: 14px; font-weight: 700; }
.sources-list dt a { color: inherit; }
.sources-list dd { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
.sources-link { display: inline-block; margin-top: 48px; color: var(--cahier-theme-strong); font-size: 13px; text-underline-offset: 4px; }
.cahier--sans-grille .cahier-section-exploration--unit-footer { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }

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
  .access-legend { grid-column: 1 / -1; grid-row: auto; }
  .bpe-profile-chart { gap: 10px; }
  .bpe-profile-bar { width: min(56px, 58%); }
}
@container cahier-page (max-width: 480px) {
  .summary-value { grid-template-columns: 1fr; gap: 5px; }
  .summary-value dd .cahier-reference-note { text-align: left; }
  .cahier--sans-grille .summary-value dd .cahier-reference-note { text-align: center; }
  .bpe-profile-bar-area { height: 125px; }
  .bpe-profile-label { font-size: 10px; }
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
