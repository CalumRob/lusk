<script setup lang="ts">
/**
 * [PROTOTYPE #511 — JETABLE] Variante D — « Cahier libre ».
 *
 * This surface is deliberately content-only. ThemeContent owns the semantic
 * claims, evidence, availability, provenance, wording, and exploration
 * targets. CahierPagination owns the presentation sequence. This component
 * only lays those two inputs out as the existing Cahier exploration.
 */
import { CarFront } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import BoutonComparaison from '@/components/fiche/BoutonComparaison.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import {
  CONTROLE_COMPARAISON_KEY,
} from '@/fiche/comparisonContext'
import type {
  AedarAccessEvidence,
  AedarEquipmentExplorerEvidence,
  ContentSection,
  CyclingOfferEvidence,
  ExplorationTarget,
  SingleUnitThemeContent,
  SharingNetworksEvidence,
  ThemeContent,
} from '@/fiche/content/themeContent'
import {
  routePourCibleExploration,
  routePourSectionExploration,
} from '@/fiche/explorationHandoff'
import type { TimeRampFigureData, TimeRampSeries } from '@/fiche/content/territoryFacts'
import {
  AEDAR_DEFAULT_VISIBLE_RAMP_MODES,
  AEDAR_RAMP_MODE_LABELS,
  AEDAR_RAMP_MODES,
  toggleAedarRampModeSelection,
} from '@/fiche/content/aedarTimeRampFacts'
import type { AedarRampMode, AedarTimeRampEvidence } from '@/fiche/content/themeContent'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import type { CahierPagination } from './cahierPagination'
import CahierProse from './CahierProse.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierComparisonValue from './CahierComparisonValue.vue'
import AccessRampFigureCahier from './AccessRampFigureCahier.vue'
import CahierRoadSurfaceFigure from './CahierRoadSurfaceFigure.vue'
import CahierSharingFigure from './CahierSharingFigure.vue'
import CahierMotorisationFigure from './CahierMotorisationFigure.vue'
import CahierOffreTransportsFigure from './CahierOffreTransportsFigure.vue'
import CartographicBreakoutPrototype from './CartographicBreakoutPrototype.vue'
import CahierBlankMapSlots from './CahierBlankMapSlots.vue'
import AedarEquipmentWaffleCahier from './AedarEquipmentWaffleCahier.vue'
import AedarEquipmentExplorerCahier from './AedarEquipmentExplorerCahier.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import AedarDiversityLossMapsCahier from './AedarDiversityLossMapsCahier.vue'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import { useCahierBaselineGrid } from './useCahierBaselineGrid'
import type { AedarDiversityLossEvidence } from '@/fiche/content/themeContent'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'

const props = defineProps<{
  content: ThemeContent | SingleUnitThemeContent
  pagination: CahierPagination
  presentation?: 'ruled' | 'plain'
  layoutVariant?: 'standard' | 'indexed-sections'
  showAllUnits?: boolean
  networkFigureVariant?: 'traces'
  showMapPrototype?: boolean
  aedarAccessEnabled?: boolean
  aedarStatus?: 'loading' | 'ready' | 'error'
}>()
const route = useRoute()

/** #860 (ruling 2026-11-03) — le contrôle de comparaison fourni par la fiche
 *  s'assied dans le page-heading collant, à gauche du titre thème·territoire.
 *  `null` (prototype hors fiche, Région) : aucun bouton. */
const controleComparaison = inject(CONTROLE_COMPARAISON_KEY, computed(() => null))

const rootRef = ref<HTMLElement | null>(null)
const activeFigure = ref('')
let observer: IntersectionObserver | null = null

const units = computed(() => props.showAllUnits ? props.content.units : props.content.units.slice(0, 1))
const unit = computed(() => units.value[0] ?? null)
const aedarAccessSelectedModes = ref<AedarRampMode[]>([...AEDAR_DEFAULT_VISIBLE_RAMP_MODES])
const aedarAccessComparisonVisible = ref(true)
function initialAedarEquipmentHorizon(): AedarEquipmentHorizon | null {
  for (const currentUnit of props.content.units) {
    for (const section of currentUnit.sections as readonly ContentSection[]) {
      const evidence = section.evidence
      if (evidence?.kind === 'aedar-equipment-profile' || evidence?.kind === 'aedar-equipment-explorer') {
        return evidence.initialHorizonMinutes
      }
    }
  }
  return null
}
const aedarSelectedHorizon = ref<AedarEquipmentHorizon | null>(initialAedarEquipmentHorizon())
const aedarAccessModeColors = Object.fromEntries(
  AEDAR_RAMP_MODES.map((mode) => [mode, AEDAR_TIME_MODE_COLORS[mode]]),
)

function isMapPrototypeSection(unitKey: string, sectionKey: string): boolean {
  return unitKey === 'partage-de-lespace-public'
    && sectionKey === 'reseaux'
}

function mapEvidenceFor(currentUnit: (typeof units.value)[number]): SharingNetworksEvidence | null {
  const section = currentUnit.sections.find((candidate) => candidate.key === 'reseaux')
  return section?.evidence?.kind === 'sharing-networks' ? section.evidence : null
}

function mapExplorationFor(currentUnit: (typeof units.value)[number]) {
  const section = currentUnit.sections.find((candidate) => candidate.key === 'reseaux')
  return section ? sectionExploration(section) : null
}

function mapCyclingEvidenceFor(currentUnit: (typeof units.value)[number]): CyclingOfferEvidence | null {
  const section = currentUnit.sections.find((candidate) => candidate.key === 'offre-cyclable')
  return section?.evidence?.kind === 'cycling-offer' ? section.evidence : null
}

function mapSourcesFor(currentUnit: (typeof units.value)[number]): readonly string[] {
  const sectionKeys = new Set(['reseaux', 'offre-cyclable'])
  const sourceIds = new Set(
    currentUnit.sections
      .filter((section) => sectionKeys.has(section.key))
      .flatMap((section) => section.provenance),
  )
  return props.content.sourceRegister
    .filter((source) => sourceIds.has(source.id))
    .map(sourceLabel)
}

function mapTaglineFor(currentUnit: (typeof units.value)[number]): string | null {
  const section = currentUnit.sections.find((candidate) => candidate.key === 'reseaux')
  return section?.lecture?.marelle ?? null
}

const pageEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === unit.value?.key) ?? null,
)
const sourceEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === 'sources') ?? null,
)

function pageEntryFor(key: string) {
  return props.pagination.entries.find((entry) => entry.key === key) ?? null
}

function pageAnchorFor(key: string): string {
  return pageEntryFor(key)?.anchor ?? `figure-${key}`
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
  const destination = explorationLinks(section)[0]?.to ?? routePourSectionExploration(section, {
    territoire: props.content.territory.code,
    type: props.content.territory.type,
  })
  if (destination) return destination
  if (aedarEquipmentProfileEvidenceFor(section) || aedarEquipmentExplorerEvidenceFor(section)) {
    return {
      path: route.path,
      query: route.query,
      hash: `#${sourceEntry.value?.anchor ?? 'figure-sources'}`,
    }
  }
  return null
}

function anchorForEntry(key: string): string {
  return props.pagination.entries.find((entry) => entry.key === key)?.anchor ?? `figure-${key}`
}

function sectionIsLoading(unitKey: string): boolean {
  return props.aedarStatus === 'loading' && unitKey === 'acces-aux-services'
}

function sectionState(section: ContentSection, unitKey: string): string {
  if (sectionIsLoading(unitKey)) return 'Chargement des données AEDAR…'
  return section.availability === 'absent'
    ? 'Contenu indisponible pour ce territoire.'
    : 'Lecture indisponible avec les données disponibles.'
}

/** Return AedarAccessEvidence when the section carries it and the prototype opt-in is enabled. */
function aedarAccessEvidenceFor(section: ContentSection): AedarAccessEvidence | null {
  if (!props.aedarAccessEnabled) return null
  if (section.evidence?.kind !== 'aedar-access') return null
  return section.evidence
}

function aedarEquipmentProfileEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-equipment-profile') return null
  return section.evidence
}

function aedarAccessModeLegendEntries(evidence: AedarAccessEvidence): readonly FigureLegendEntry[] {
  const referenceLabel = evidence.ramps.find((ramp) => ramp.referenceLabel)?.referenceLabel
  return [
    ...AEDAR_RAMP_MODES.map((mode) => ({
      key: mode,
      label: AEDAR_RAMP_MODE_LABELS[mode],
      marker: 'line' as const,
    })),
    ...(referenceLabel ? [{
      key: 'reference',
      label: 'Groupe comparé',
      ariaLabel: `Groupe comparé : ${referenceLabel}`,
      marker: 'dash' as const,
      tone: 'peer',
    }] : []),
  ]
}

function toggleAedarAccessMode(key: string): void {
  if (key === 'reference') {
    aedarAccessComparisonVisible.value = !aedarAccessComparisonVisible.value
    return
  }
  aedarAccessSelectedModes.value = toggleAedarRampModeSelection(aedarAccessSelectedModes.value, key as AedarRampMode)
}

function aedarEquipmentExplorerEvidenceFor(section: ContentSection): AedarEquipmentExplorerEvidence | null {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-equipment-explorer') return null
  return section.evidence
}

function aedarCarAccessOverviewEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-car-overview') return null
  return section.evidence
}

function aedarDiversityLossEvidenceFor(section: ContentSection): AedarDiversityLossEvidence | null {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-diversity-loss') return null
  return section.evidence
}

function isAedarAccessSection(section: ContentSection): boolean {
  return section.evidence?.kind === 'aedar-access'
}

/** Convert AedarTimeRampEvidence to the generic TimeRampFigureData expected by AccessRampFigureCahier. */
function rampToTimeRampFigureData(ramp: AedarTimeRampEvidence): TimeRampFigureData {
  const series: readonly TimeRampSeries[] = AEDAR_RAMP_MODES.map((mode) => ({
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    points: ramp.xAxis.values.map((xValue, index) => ({
      xValue,
      xLabel: ramp.xAxis.labels[index] ?? `${xValue}`,
      value: ramp.territory[mode][index] ?? null,
      referenceValue: ramp.reference?.[mode][index] ?? null,
    })),
  }))
  return {
    availability: ramp.availability,
    xAxis: { label: ramp.xAxis.label, unit: ramp.xAxis.unit },
    yAxis: { label: ramp.yAxis.label, unit: ramp.yAxis.unit },
    series,
    provenance: ramp.provenance,
    comparisonLabel: ramp.referenceLabel,
  }
}
function sourceLabel(source: { source: string; version: string }): string {
  const separator = source.source.indexOf(' — ')
  const shortSource = separator < 0 ? source.source : source.source.slice(0, separator)
  return `${shortSource} · ${source.version}`
}

const sourceLabels = computed(() => props.content.sourceRegister.map(sourceLabel))

useCahierBaselineGrid(rootRef, () => props.presentation !== 'plain')

onMounted(() => {
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
})
</script>

<template>
  <article
    ref="rootRef"
    class="cahier presentation-editorial"
    :class="{
      'cahier--sans-grille': props.presentation === 'plain',
      'cahier--indexed-sections': props.layoutVariant === 'indexed-sections',
    }"
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
          v-for="currentUnit in units"
          :key="currentUnit.key"
          :id="pageAnchorFor(currentUnit.key)"
          class="cahier-page"
          :data-figure="pageAnchorFor(currentUnit.key)"
          :aria-labelledby="`${pageAnchorFor(currentUnit.key)}-title`"
        >
          <div
            class="page-layout"
            :class="{ 'page-layout--sticky': props.presentation === 'plain' }"
          >
            <div class="page-main">
              <header class="page-heading">
                <span
                  v-if="props.layoutVariant === 'indexed-sections'"
                  class="page-heading-index"
                >
                  <span class="page-heading-sr-only">Page </span>
                  <span>{{ String(pageEntryFor(currentUnit.key)?.page ?? pagination.currentPage).padStart(2, '0') }}</span>
                  <small>/{{ String(pagination.totalPages).padStart(2, '0') }}</small>
                </span>
                <h2
                  class="cahier-baseline-anchor"
                  :id="`${pageAnchorFor(currentUnit.key)}-title`"
                >{{ currentUnit.label }}</h2>
                <span
                  v-if="props.layoutVariant === 'indexed-sections'"
                  class="page-heading-context"
                >
                  <!-- #860 : « Comparaison », aligné à droite, immédiatement à
                       gauche du titre thème·territoire dans le heading collant. -->
                  <BoutonComparaison
                    v-if="controleComparaison"
                    class="page-heading-comparaison"
                    :selection="controleComparaison.selection"
                    :libelle-actif="controleComparaison.libelleActif"
                    :preset-defaut="controleComparaison.presetDefaut"
                    :presets="controleComparaison.presets"
                    @choisir="controleComparaison.choisir"
                  />
                  <span class="page-heading-theme">{{ props.content.label }}</span>
                  <span class="page-heading-context-separator" aria-hidden="true">·</span>
                  <span class="page-heading-territory" :title="props.content.territory.name">{{ props.content.territory.name }}</span>
                </span>
              </header>

              <div class="page-copy">
                <CahierProse class="page-subtitle" :blocks="currentUnit.introduction" />
                <CahierProse v-if="currentUnit.rundown" class="page-subtitle page-rundown" :blocks="currentUnit.rundown" />
              </div>

              <div class="figure-stack">
                <section
              v-for="(section, sectionIndex) in currentUnit.sections"
              :key="section.key"
              class="concept-group"
              :data-section="section.key"
              :class="`cahier-section--${section.availability}`"
            >
              <div v-if="!isMapPrototypeSection(currentUnit.key, section.key)" class="concept-group-heading cahier-baseline-group">
                <span v-if="props.layoutVariant !== 'indexed-sections'">{{ String(sectionIndex + 1).padStart(2, '0') }}</span>
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
                v-if="aedarCarAccessOverviewEvidenceFor(section)"
                class="figure-spread figure-spread--paired"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <CahierBlankMapSlots
                  class="evidence-side evidence-figure"
                  :territory="aedarCarAccessOverviewEvidenceFor(section)!.territory"
                  :horizon-minutes="aedarCarAccessOverviewEvidenceFor(section)!.horizonMinutes"
                  :title="aedarCarAccessOverviewEvidenceFor(section)!.mapFigureTitle"
                  :mode-keys="aedarCarAccessOverviewEvidenceFor(section)!.mapModes"
                />
                <aside class="argument-side aedar-car-overview-reading">
                  <div class="aedar-car-overview-copy">
                    <CahierProse class="argument-copy" :blocks="aedarCarAccessOverviewEvidenceFor(section)!.prose" />
                    <CahierEvidenceSource v-if="aedarCarAccessOverviewEvidenceFor(section)!.source" :source="aedarCarAccessOverviewEvidenceFor(section)!.source!" />
                  </div>
                  <figure class="aedar-car-overview-scalars">
                    <figcaption class="cahier-figure-title">{{ aedarCarAccessOverviewEvidenceFor(section)!.scalarFigureTitle }}</figcaption>
                    <div class="summary-metrics summary-metrics--paired">
                      <CahierFigureScalar
                        v-for="scalar in aedarCarAccessOverviewEvidenceFor(section)!.scalars"
                        :key="scalar.key"
                        :value="scalar.value === null ? '—' : formatNumber(scalar.value)"
                        :label="scalar.label"
                        label-role="metric"
                        :icon="CarFront"
                        tone="c"
                        color-value
                        :aria-label="`${scalar.label} : ${scalar.value === null ? 'indisponible' : `${formatNumber(scalar.value)} ${scalar.unit}`}. ${aedarCarAccessOverviewEvidenceFor(section)!.scalarFigureTitle}.${scalar.reference ? ` ${scalar.reference.label} : ${formatNumber(scalar.reference.value)} ${scalar.reference.unit}.` : scalar.comparisonUnavailableLabel ? ` ${scalar.comparisonAccessibleLabel ?? 'Moyenne du groupe comparé'} indisponible.` : ''}`"
                      >
                        <template v-if="scalar.reference || scalar.comparisonUnavailableLabel" #reference>
                          <CahierComparisonValue
                            v-if="scalar.reference"
                            :named-reference="scalar.reference"
                          />
                          <span v-else class="cahier-figure-comparison">{{ scalar.comparisonUnavailableLabel }}</span>
                          <span v-if="scalar.rankUnavailableLabel" class="cahier-figure-comparison">{{ scalar.rankUnavailableLabel }}</span>
                        </template>
                      </CahierFigureScalar>
                    </div>
                  </figure>
                </aside>
              </section>

              <section
                v-else-if="aedarDiversityLossEvidenceFor(section)"
                class="figure-spread figure-spread--aedar-diversity-loss"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <AedarDiversityLossMapsCahier
                  :evidence="aedarDiversityLossEvidenceFor(section)!"
                />
              </section>

              <div
                v-else-if="isMapPrototypeSection(currentUnit.key, section.key)"
                class="map-figure-spread"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <CartographicBreakoutPrototype
                  :evidence="mapEvidenceFor(currentUnit)"
                  :cycling-evidence="mapCyclingEvidenceFor(currentUnit)"
                  :section-number="props.layoutVariant === 'indexed-sections' ? undefined : String(sectionIndex + 1).padStart(2, '0')"
                  :sources="mapSourcesFor(currentUnit)"
                  :tagline="mapTaglineFor(currentUnit)"
                  :exploration-to="mapExplorationFor(currentUnit)"
                  :territory="props.content.territory"
                />
              </div>

                <section
                  v-else
                  class="figure-spread"
                  :class="{
                    'figure-spread--flip': sectionIndex % 2 === 1,
                    'figure-spread--aedar-equipment-profile': aedarEquipmentProfileEvidenceFor(section) !== null,
                    'figure-spread--aedar-equipment-explorer': aedarEquipmentExplorerEvidenceFor(section) !== null,
                  }"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <div
                  v-if="!aedarEquipmentProfileEvidenceFor(section) && !aedarEquipmentExplorerEvidenceFor(section) && (props.presentation !== 'plain' || section.lecture?.prose.length || (!isAedarAccessSection(section) && !section.lecture && section.availability !== 'complete'))"
                  class="argument-side"
                >
                  <template v-if="section.lecture">
                    <h4
                      v-if="props.presentation !== 'plain'"
                      class="cahier-baseline-anchor cahier-marelle-anchor"
                    >{{ section.lecture.marelle }}</h4>
                    <CahierProse v-if="section.lecture?.prose.length" class="argument-copy" :blocks="section.lecture?.prose ?? []" />
                  </template>
                  <div
                    v-if="props.presentation !== 'plain' && section.explorationTargets.length > 0 && sectionExploration(section)"
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
                  <p v-if="!isAedarAccessSection(section) && !section.lecture && section.availability !== 'complete'" class="cahier-section-state" :role="sectionIsLoading(currentUnit.key) ? 'status' : 'note'">{{ sectionState(section, currentUnit.key) }}</p>

                </div>

                  <div
                    v-if="aedarAccessEvidenceFor(section)"
                    class="evidence-side evidence-figure aedar-access-evidence"
                  >
                    <aside class="aedar-reading">
                      <CahierProse class="argument-copy" :blocks="aedarAccessEvidenceFor(section)!.sectionProse" />
                      <CahierEvidenceSource v-if="aedarAccessEvidenceFor(section)!.source" :source="aedarAccessEvidenceFor(section)!.source!" />
                    </aside>
                    <div class="aedar-analysis">
                      <figure
                        v-for="ramp in aedarAccessEvidenceFor(section)!.ramps"
                        :key="ramp.rampKey"
                        class="aedar-ramp"
                      >
                        <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ ramp.figureTitle }}</figcaption>
                        <AccessRampFigureCahier
                          :time-ramp="rampToTimeRampFigureData(ramp)"
                          :territory-name="aedarAccessEvidenceFor(section)!.territory.name"
                          v-model:selected-modes="aedarAccessSelectedModes"
                          :show-mode-legend="false"
                          :comparison-visible="aedarAccessComparisonVisible"
                        />
                      </figure>
                    </div>
                     <!-- The shared legend controls modes and the comparison curve on both ramps. -->
                     <CahierFigureLegend
                      class="aedar-access-mode-selector"
                      :entries="aedarAccessModeLegendEntries(aedarAccessEvidenceFor(section)!)"
                      :mark-colors="aedarAccessModeColors"
                       :selected-keys="[...aedarAccessSelectedModes, ...(aedarAccessComparisonVisible ? ['reference'] : [])]"
                       :toggle-keys="[...AEDAR_RAMP_MODES, ...(aedarAccessEvidenceFor(section)!.comparisonLabel ? ['reference'] : [])]"
                       label="Modes de déplacement et groupe comparé pour les deux rampes"
                      @toggle="toggleAedarAccessMode"
                    />
                  </div>

                  <div
                    v-if="aedarEquipmentProfileEvidenceFor(section)"
                    class="evidence-side evidence-figure aedar-equipment-profile-evidence"
                  >
                    <AedarEquipmentWaffleCahier
                      :evidence="aedarEquipmentProfileEvidenceFor(section)!"
                      :title="section.label"
                      v-model:selected-horizon="aedarSelectedHorizon"
                    />
                  </div>

                  <CahierProse
                    v-if="aedarEquipmentProfileEvidenceFor(section)"
                    class="argument-copy"
                    data-aedar-profile-explanation
                    :blocks="aedarEquipmentProfileEvidenceFor(section)!.prose"
                  />
                  <CahierEvidenceSource
                    v-if="aedarEquipmentProfileEvidenceFor(section)?.source"
                    :source="aedarEquipmentProfileEvidenceFor(section)!.source!"
                  />

                  <div
                    v-if="aedarEquipmentExplorerEvidenceFor(section)"
                    class="evidence-side evidence-figure aedar-equipment-explorer-evidence"
                  >
                    <AedarEquipmentExplorerCahier
                      :evidence="aedarEquipmentExplorerEvidenceFor(section)!"
                      v-model:selected-modes="aedarAccessSelectedModes"
                      v-model:selected-horizon="aedarSelectedHorizon"
                      v-model:comparison-visible="aedarAccessComparisonVisible"
                    />
                  </div>


                  <template v-if="section.evidence?.kind === 'sharing-networks' && !(props.showMapPrototype && currentUnit.key === 'partage-de-lespace-public')">
                    <div
                      v-if="props.networkFigureVariant === 'traces'"
                      class="evidence-side sharing-networks-evidence"
                    >
                      <CahierRoadSurfaceFigure
                        :evidence="section.evidence"
                        :targets="section.explorationTargets"
                      />
                      <figure class="sharing-network-figure evidence-figure">
                        <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.evidence.networkReadingsLabel }}</figcaption>
                        <CahierSharingFigure
                          :evidence="section.evidence"
                          :targets="section.explorationTargets"
                         :network-figure-variant="props.networkFigureVariant"
                         :comparison-label="section.evidence.comparisonLabel"
                         />
                        <CahierFigureLecture>
                          <CahierProse :blocks="section.evidence.figureLecture" />
                        </CahierFigureLecture>
                      </figure>
                    </div>
                    <figure
                      v-else
                      class="evidence-side evidence-figure sharing-networks-evidence"
                    >
                      <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.evidence.figureTitle }}</figcaption>
                      <CahierSharingFigure
                        :evidence="section.evidence"
                        :targets="section.explorationTargets"
                        :network-figure-variant="props.networkFigureVariant"
                        :comparison-label="section.evidence.comparisonLabel"
                      />
                      <CahierFigureLecture>
                        <CahierProse :blocks="section.evidence.figureLecture" />
                      </CahierFigureLecture>
                    </figure>
                  </template>

                   <figure
                     v-else-if="section.evidence?.kind === 'cycling-offer'"
                     class="evidence-side evidence-figure sharing-cycling-offer-evidence"
                   >
                     <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.evidence.figureTitle }}</figcaption>
                     <CahierSharingFigure
                       :evidence="section.evidence"
                       :targets="section.explorationTargets"
                       :comparison-label="section.evidence.comparisonLabel"
                     />
                     <CahierFigureLecture>
                       <CahierProse :blocks="section.evidence.figureLecture" />
                     </CahierFigureLecture>
                   </figure>

                    <figure
                      v-else-if="section.evidence?.kind === 'sharing-parking'"
                    class="evidence-side evidence-figure sharing-parking-evidence"
                  >
                    <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.evidence.figureTitle }}</figcaption>
                    <CahierSharingFigure
                      :evidence="section.evidence"
                      :targets="section.explorationTargets"
                      :comparison-label="section.evidence.comparisonLabel"
                    />
                    <CahierFigureLecture>
                      <CahierProse :blocks="section.evidence.figureLecture" />
                    </CahierFigureLecture>
                   </figure>

                   <figure v-else-if="section.evidence?.kind === 'motorisation'" class="evidence-side evidence-figure">
                     <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.label }}</figcaption>
                     <CahierMotorisationFigure :composition="section.evidence.composition" :charging="section.evidence.charging" />
                   </figure>
                   <figure v-else-if="section.evidence?.kind === 'public-transport'" class="evidence-side evidence-figure">
                     <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ section.label }}</figcaption>
                     <CahierOffreTransportsFigure :offer="section.evidence.offer" :trajectory="section.evidence.trajectory" :comparison-trajectory="section.evidence.comparisonTrajectory" :metadata="section.evidence.trajectoryMetadata" />
                   </figure>


                  <div v-else-if="!aedarAccessEvidenceFor(section) && !aedarEquipmentProfileEvidenceFor(section) && !aedarEquipmentExplorerEvidenceFor(section)" class="evidence-side evidence-placeholder" :role="sectionIsLoading(currentUnit.key) ? 'status' : 'note'">
                  <span>{{ sectionState(section, currentUnit.key) }}</span>
                </div>
              </section>
              <div
                v-if="props.presentation === 'plain' && (sectionExploration(section) || aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section)) && !(props.showMapPrototype && currentUnit.key === 'partage-de-lespace-public' && section.key === 'reseaux')"
                class="cahier-section-footer"
              >
                <div
                  v-if="props.presentation === 'plain' && (sectionExploration(section) || aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section)) && !(props.showMapPrototype && currentUnit.key === 'partage-de-lespace-public' && section.key === 'reseaux')"
                  class="cahier-section-exploration cahier-section-exploration--unit-footer"
                  :aria-label="aedarEquipmentProfileEvidenceFor(section) ? 'Consulter les sources de cette section' : 'Explorer les indicateurs de cette section'"
                >
                  <PassarelleExploration
                    :to="sectionExploration(section)"
                    :title="(aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section)) && !sectionExploration(section) ? 'Exploration AEDAR à venir' : undefined"
                    libelle="En savoir plus"
                    sans-soulignement
                    nouvel-onglet
                    class="cahier-baseline-anchor"
                  />
                </div>
              </div>
                </section>
              </div>
            </div>

            <aside v-if="props.layoutVariant !== 'indexed-sections'" class="page-margin" aria-label="Informations marginales">
              <div class="page-number">
                <span>page</span>
                {{ String(pageEntryFor(currentUnit.key)?.page ?? pagination.currentPage).padStart(2, '0') }}<small>/{{ String(pagination.totalPages).padStart(2, '0') }}</small>
              </div>
              <div v-if="sourceLabels.length > 0" class="margin-sources">
                <span class="margin-label">Sources</span>
                <RouterLink v-for="source in sourceLabels" :key="source" to="/sources">{{ source }}</RouterLink>
              </div>
            </aside>
          </div>
        </section>

        <section
          :id="sourceEntry?.anchor ?? 'figure-sources'"
          class="sources-page"
          :data-figure="sourceEntry?.anchor ?? 'figure-sources'"
          aria-labelledby="sources-title"
        >
          <div v-if="props.layoutVariant !== 'indexed-sections'" class="page-margin" aria-hidden="true"><div class="page-number"><span>fin</span> ·</div></div>
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
  --z-page-header: calc(var(--z-sticky) - 1);
  /* ThemeTabs is bounded to .fiche-en-tete-surface; only AppHeader stays pinned over the reading surface. */
  --cahier-sticky-top: var(--header-height);
  --paper: var(--editorial-paper);
  --paper-deep: var(--editorial-paper-deep);
  --ink: var(--editorial-ink);
  --muted: var(--editorial-muted);
  --red: var(--editorial-margin);
  --red-soft: var(--editorial-margin-soft);
  --cahier-default: var(--muted);
  --cahier-profile-inaccessible: color-mix(in srgb, var(--cahier-default) 42%, var(--paper));
  --margin-line: var(--editorial-margin-offset);
  --rule: color-mix(in srgb, var(--cahier-theme) 19%, transparent);
  --fine-rule: color-mix(in srgb, var(--cahier-theme) 8%, transparent);
  min-height: 0;
  color: var(--ink);
  background: transparent;
  font-family: var(--font-body);
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
.cahier--sans-grille .cahier-page,
.cahier--sans-grille .sources-page { scroll-margin-top: var(--cahier-sticky-top); }
.page-margin { position: absolute; top: 48px; left: 18px; display: grid; width: 72px; gap: 30px; align-content: start; text-align: center; }
.cahier--sans-grille .page-margin { right: 18px; left: auto; }
@media (min-width: 761px) {
  .cahier--sans-grille .cahier-page { padding-top: 0; }
  .page-layout--sticky { display: grid; grid-template-columns: minmax(0, 1fr) var(--page-right-inset); margin-right: calc(0px - var(--page-right-inset)); }
  .page-layout--sticky .page-heading { position: sticky; top: var(--cahier-sticky-top); z-index: var(--z-page-header); padding-top: var(--space-12); background-color: var(--paper); }
  .page-layout--sticky > .page-margin { position: sticky; top: var(--cahier-sticky-top); grid-column: 2; grid-row: 1; align-self: start; width: 72px; margin-right: 18px; margin-left: auto; padding-top: var(--space-12); right: auto; left: auto; }
}
.page-number { display: grid; gap: 3px; color: var(--red); font-family: var(--font-ui); font-size: 29px; line-height: .9; }
.page-number span, .page-number small { color: var(--muted); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); }
.page-number span { text-transform: uppercase; }
.margin-sources { display: grid; gap: 10px; justify-items: center; overflow-wrap: anywhere; }
.margin-sources a { color: var(--cahier-theme-strong); font: 500 var(--text-source-stamp-size)/1.4 var(--font-metadata); letter-spacing: var(--text-caption-tracking); text-decoration-thickness: 1px; text-underline-offset: 3px; word-break: break-word; }
.page-heading { padding-right: calc(var(--page-left-inset) - var(--page-right-inset)); }
.page-copy { padding-right: calc(var(--page-left-inset) - var(--page-right-inset)); padding-bottom: 18px; }
.page-layout--sticky .page-main { min-width: 0; }
.page-layout--sticky .page-heading { padding-right: 0; padding-left: 0; padding-bottom: var(--space-2); border-bottom: 1px solid var(--red-soft); }
.page-layout--sticky .page-copy { padding-right: 0; padding-left: 0; }
.page-heading h2 { max-width: none; margin: 0; color: var(--ink); font: var(--text-page-heading); letter-spacing: var(--text-page-heading-tracking); text-align: center; }
.cahier--indexed-sections {
  --cahier-indexed-heading-index-column: 72px;
  --cahier-indexed-heading-column-gap: var(--space-6);
  --cahier-indexed-heading-margin-block-end: calc(var(--space-6) + var(--space-1));
  --cahier-indexed-heading-padding-block-start: var(--space-4);
  --cahier-indexed-heading-padding-block-end: 14px;
  --cahier-page-right-inset: var(--cahier-page-left-inset);
}
.cahier--indexed-sections .cahier-page,
.cahier--indexed-sections .sources-page { background-image: none; --page-left-inset: var(--cahier-page-left-inset, 64px); }
.cahier--indexed-sections .page-layout--sticky { display: grid; grid-template-columns: minmax(0, 1fr); margin-right: 0; }
.cahier--indexed-sections .page-layout--sticky .page-heading {
  position: sticky;
  top: var(--cahier-sticky-top);
  z-index: var(--z-page-header);
  display: grid;
  grid-template-columns: var(--cahier-indexed-heading-index-column) minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--cahier-indexed-heading-column-gap);
  margin-bottom: var(--cahier-indexed-heading-margin-block-end);
  padding: var(--cahier-indexed-heading-padding-block-start) 0 var(--cahier-indexed-heading-padding-block-end);
  border-bottom: 1px solid var(--red-soft);
  background-color: var(--paper);
}
.cahier--indexed-sections .page-heading-index { color: var(--red); font: 500 12px/1.3 var(--font-ui); font-variant-numeric: tabular-nums; }
.cahier--indexed-sections .page-heading-index small { margin-left: 3px; color: var(--muted); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); }
.cahier--indexed-sections .page-heading-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.cahier--indexed-sections .page-heading-context { display: flex; align-items: baseline; justify-self: end; gap: 6px; max-width: min(32vw, 18rem); min-width: 0; font-family: var(--font-ui); font-size: var(--text-cahier-min-size); line-height: 1.3; white-space: nowrap; }
.cahier--indexed-sections .page-heading-theme { flex: none; color: var(--cahier-theme-strong); font-weight: 600; }
.cahier--indexed-sections .page-heading-context-separator { flex: none; color: var(--muted); }
.cahier--indexed-sections .page-heading-territory { min-width: 0; overflow: hidden; color: var(--accent-primary); font-weight: 600; text-align: right; text-overflow: ellipsis; }
/* #860 — le bouton « Comparaison » reste centré dans la rangée du heading
   (align-items: baseline) sans l'épaissir ; le territoire tronque à sa droite. */
.cahier--indexed-sections .page-heading-comparaison { position: static; align-self: center; flex: none; margin-inline-end: var(--space-2); }
/* Réserver la colonne de contexte indépendamment du contrôle : son apparition
   ne doit pas réduire le titre et lui ajouter une ligne sur ordinateur. */
.cahier--indexed-sections .page-heading-context { position: relative; inline-size: min(32vw, 18rem); }
.cahier--indexed-sections .page-heading h2 {
  max-width: none;
  text-align: left;
}
.cahier--indexed-sections .page-copy { padding-right: 0; padding-left: 0; }
.cahier--indexed-sections .page-subtitle,
.cahier--indexed-sections .argument-copy { text-align: left; }
.page-subtitle { max-width: none; margin: 14px 0 0; color: var(--cahier-default); font-size: 15px; text-align: justify; }
.figure-stack {
  position: static;
  min-width: 0;
}

.aedar-access-evidence { display: grid; grid-column: 1 / -1; width: 100%; gap: var(--space-6); }
.aedar-analysis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; justify-content: center; gap: var(--space-8); }
.aedar-access-mode-selector { justify-content: center; margin: 0; }
.aedar-access-mode-selector :deep(.cahier-figure-legend-toggle) { min-height: 36px; }
.aedar-ramp { width: min(100%, var(--cahier-figure-width-compact, 560px)); justify-self: center; margin: 0; display: grid; gap: var(--space-3); }
.aedar-reading { display: grid; align-content: center; gap: var(--space-4); min-width: 0; }
.aedar-reading .argument-copy { margin: 0; }
.aedar-car-overview-reading { display: grid; align-self: center; gap: var(--space-8); }
.aedar-car-overview-copy { display: grid; gap: var(--space-3); }
.aedar-car-overview-copy .argument-copy { margin: 0; }
.aedar-car-overview-scalars { --cahier-figure-title-gap: var(--space-6); width: 100%; margin: 0; }
@media (max-width: 760px) { .aedar-analysis { grid-template-columns: minmax(0, 1fr); } }
.concept-group {
  container: subgroup / inline-size;
  margin: 0 0 var(--cahier-group-gap, var(--space-8));
}
.cahier--sans-grille .concept-group {
  padding: var(--cahier-unit-padding);
  border: 1px solid color-mix(in srgb, var(--cahier-theme) 24%, var(--paper));
  background: transparent;
}
.concept-group { width: 100%; }
.map-figure-spread {
  width: 100%;
  min-width: 0;
}
.map-figure-spread .map-breakout { margin-top: 0; }
.concept-group-heading { display: flex; align-items: baseline; justify-content: center; gap: 14px; padding: var(--cahier-unit-heading-padding, 8px 0 14px); }
.cahier--sans-grille .concept-group-heading { --cahier-unit-heading-padding: 0 0 var(--space-4); }
.concept-group-heading-copy { display: grid; gap: 4px; min-width: 0; text-align: center; }
.concept-group-label { color: var(--cahier-theme-strong); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); text-transform: uppercase; }
.concept-group-heading > span { color: var(--red); font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: .08em; }
.concept-group-heading h3 { margin: 0; color: var(--ink); font: var(--text-cahier-section); }
.cahier--sans-grille .concept-group-narrative { font-size: clamp(1.05rem, 1.4vw, 1.35rem); font-style: italic; font-weight: 400; line-height: 1.15; text-wrap: balance; }
.figure-spread { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(420px, 1.2fr); column-gap: clamp(40px, 5vw, 76px); row-gap: var(--cahier-spread-gap, 34px); align-items: start; padding: var(--cahier-spread-padding, 22px) 0; }
.figure-spread--aedar-equipment-profile { grid-template-columns: minmax(0, 1fr); }
.figure-spread--aedar-equipment-explorer { grid-template-columns: minmax(0, 1fr); }
.figure-spread--aedar-diversity-loss { grid-template-columns: minmax(0, 1fr); }
.cahier--sans-grille .figure-spread { grid-template-columns: 1fr; column-gap: 0; }
.cahier--sans-grille .figure-spread--paired {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: clamp(24px, 4vw, 56px);
}
.cahier--sans-grille .figure-spread--paired .evidence-figure { width: min(100%, 560px); margin-inline: auto; }
.figure-spread--flip .argument-side { order: 2; }
.figure-spread--flip .evidence-side { order: 1; }
.argument-side, .evidence-side { min-width: 0; }
.argument-side { --mode-scalar-width: 160px; }
.sharing-networks-evidence { display: grid; gap: var(--space-6); }
.sharing-network-figure { margin: 0; }
.argument-side h4 { margin: 0; color: var(--cahier-theme-emphasis); font-family: 'Marelle', var(--font-section-title); font-size: clamp(calc(1rem + 2px), calc(1.35vw + 2px), calc(1.25rem + 2px)); font-weight: 500; line-height: var(--cahier-grid-jump); }
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
  width: min(100%, var(--cahier-figure-width-standard, 760px));
  margin-inline: auto;
}
.cahier--sans-grille .summary-bar-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
.cahier--sans-grille .summary-metric-title {
  color: var(--cahier-default);
  font: var(--type-figure-label);
  font-family: var(--font-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  line-height: 1.2;
  text-align: center;
  text-transform: uppercase;
}
.cahier-tooltip-trigger { cursor: help; }
.summary-stack[tabindex]:focus-visible { outline: 2px solid var(--cahier-region-emphasis); outline-offset: 4px; }
 .summary-mode-key { --cahier-figure-legend-margin: var(--space-4) 0 0; }
.summary-bar-metrics { gap: var(--space-3); }
.summary-loss-metrics { margin-top: var(--space-3); }
.summary-metrics { display: grid; gap: 42px; }
.summary-metric { min-width: 0; }
.summary-metric-title { margin: 0; color: var(--brand-700); font: var(--type-figure-title); }
.summary-metric-title span { color: var(--cahier-default); font: var(--text-caption); white-space: nowrap; }
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
.summary-value dd strong { font: var(--type-figure-value); font-variant-numeric: tabular-nums; }
.summary-value dd small { color: var(--cahier-default); font: var(--text-caption); }
.summary-value dd .cahier-comparison-value { grid-column: 1 / -1; text-align: left; }
.cahier--sans-grille .summary-value dd .cahier-comparison-value { text-align: center; }
 .cahier--sans-grille .summary-metric > .summary-loss { margin-top: var(--space-4); padding-top: var(--space-3); }
.summary-loss { min-width: 0; }
.summary-loss-title { display: block; color: var(--cahier-default); font: var(--text-caption); text-align: center; }
.summary-loss-readings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.summary-value--t dt, .summary-value--t dd strong { color: var(--color-figure-mode-foot); }
.summary-value--b dt, .summary-value--b dd strong { color: var(--color-figure-mode-bike); }
.summary-value--c dt, .summary-value--c dd strong { color: var(--color-figure-mode-car); }
.mode-figures { display: grid; gap: 0; margin: 16px 0 0; }
.mode-figures-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--mode-scalar-width); gap: 12px; color: var(--cahier-default); text-align: center; }
.mode-figure { padding: 14px 0 34px; }
.mode-figure-scalar { width: 100%; }

.regional-reading { font: var(--text-caption); line-height: 1.25; }

.access-figure-collection { margin: 0; padding: 12px 0 0; }
.cahier--sans-grille .access-figure-collection { width: min(100%, var(--cahier-figure-width-standard, 760px)); margin-inline: auto; }
.access-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 18px; align-items: start; }
.access-figure { position: relative; display: grid; min-width: 0; gap: 8px; justify-items: center; margin: 0; }
.access-service-label { min-height: 1.4em; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.4; text-align: center; }
.access-legend { display: grid; gap: 7px; justify-items: center; margin-top: var(--space-5); color: var(--cahier-default); font: var(--text-caption); text-align: center; }
.access-legend p { margin: 0 0 3px; }

.bpe-evidence { min-width: 0; }
.bpe-profile-total { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); text-align: center; }

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

/* A subgroup's figure spread collapses when the content rail cannot hold both
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
  .cahier--sans-grille .figure-spread--paired { grid-template-columns: 1fr; row-gap: var(--cahier-spread-gap, 24px); }
}
@container cahier-page (max-width: 480px) {
  .summary-value { grid-template-columns: 1fr; gap: 5px; }
   .summary-value dd .cahier-comparison-value { text-align: left; }
   .cahier--sans-grille .summary-value dd .cahier-comparison-value { text-align: center; }
}

@media (max-width: 760px) {
  .cahier--sans-grille { --cahier-page-left-inset: 28px; --cahier-page-right-inset: 116px; }
  .cahier--indexed-sections { --cahier-page-right-inset: var(--cahier-page-left-inset); }
  .cahier { --margin-line: 82px; }
  .cahier-page,
  .sources-page { border: 0; box-shadow: none; }
  .cahier-reader {
    width: calc(100% + 2 * var(--grid-margin-mobile));
    margin-inline: calc(0px - var(--grid-margin-mobile));
    grid-template-columns: 1fr;
    padding: 0 0 64px;
  }
  .cahier-page,
  .sources-page {
    --page-left-inset: var(--space-4);
    --page-right-inset: var(--space-4);
    padding-inline: var(--space-4);
  }
  .cahier-spine { display: none; }
  .mobile-index { display: block; padding: 0 24px; border-bottom: 1px solid var(--red-soft); background: var(--paper); }
  .mobile-index summary { padding: 17px 0; color: var(--cahier-theme-strong); cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .mobile-index nav { display: grid; gap: 2px; padding: 0 0 18px 18px; }
  .mobile-index a { display: flex; gap: 12px; padding: 8px 0; color: var(--muted); font-size: 14px; text-decoration: none; }
  .page-margin { position: static; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; width: auto; margin: 0 0 var(--space-5); text-align: left; }
  .margin-sources { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-end; gap: 6px 12px; }
  .margin-sources .margin-label { flex-basis: 100%; text-align: right; }
  .page-number { font-size: 24px; }
}
@media (max-width: 600px) {
  .cahier--sans-grille { --cahier-page-left-inset: 18px; --cahier-page-right-inset: 96px; }
  .cahier--indexed-sections { --cahier-page-right-inset: var(--cahier-page-left-inset); }
  .cahier { --margin-line: 12px; }
  .cahier-home-link { display: none; }
  .cahier-reader { padding: 0 0 88px; }
  .cahier-pages { gap: 64px; }
  .cahier-page, .sources-page { --page-left-inset: var(--space-4); --page-right-inset: var(--space-4); padding: 36px var(--space-4) 40px; }
  .cahier--indexed-sections {
    --cahier-indexed-heading-index-column: 36px;
    --cahier-indexed-heading-column-gap: var(--space-2);
    --cahier-indexed-heading-margin-block-end: var(--space-5);
    --cahier-indexed-heading-padding-block-start: var(--space-3);
    --cahier-indexed-heading-padding-block-end: 10px;
  }
  .cahier--indexed-sections .page-layout--sticky .page-heading {
    grid-template-columns: var(--cahier-indexed-heading-index-column) minmax(0, 1fr);
  }
  .cahier--indexed-sections .page-heading-index { grid-column: 1; grid-row: 1; }
  .cahier--indexed-sections .page-heading h2 { grid-column: 1 / -1; grid-row: 2; }
  .cahier--indexed-sections .page-heading-context {
    grid-column: 2;
    grid-row: 1;
    max-width: 100%;
    inline-size: 100%;
  }
  .figure-spread { padding: var(--cahier-spread-padding, 28px) 0; }
  .access-figures { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .cahier * { scroll-behavior: auto !important; }
}
</style>
