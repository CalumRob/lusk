<script setup lang="ts">
/**
 * [PROTOTYPE JETABLE] Two ways a cartographic breakout could interrupt the
 * existing Variant E layout. Switch with ?plate=A|C and ?map=rennes|bretagne|redon.
 * Existing QGIS PNGs are loaded directly through Vite's dev-only /@fs seam.
 */
import { Bike, CarFront, ChevronLeft, ChevronRight, Footprints } from 'lucide-vue-next'
import Viewer from 'viewerjs'
import 'viewerjs/dist/viewer.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'

import type { CahierTooltipRow, FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import type { CyclingOfferEvidence, SharingNetworksEvidence } from '@/fiche/content/themeContent'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierProse from './CahierProse.vue'
import type { CahierNetworkBarRow } from './CahierNetworkBarChart.vue'
import CahierNetworkBarChart from './CahierNetworkBarChart.vue'

type PlateVariant = 'A' | 'B' | 'C'
type TerritoryKey = 'rennes' | 'bretagne' | 'redon'
type ModeKey = 'walk' | 'bike' | 'car'

interface MapMetadata {
  scale?: {
    units?: string
    total?: number
  }
}

interface TerritoryPrototype {
  label: string
  type: 'commune' | 'region' | 'epci'
  file: string
  regionalLabel: string
}

const route = useRoute()
const router = useRouter()

const variants: readonly PlateVariant[] = ['A', 'C']
const variantLabels: Readonly<Record<PlateVariant, string>> = {
  A: 'Triptyque',
  B: 'Déroulé',
  C: 'Atlas circulaire',
}
const territories: Readonly<Record<TerritoryKey, TerritoryPrototype>> = {
  rennes: { label: 'Rennes', type: 'commune', file: '35238_Rennes.png', regionalLabel: 'Bretagne' },
  bretagne: { label: 'Bretagne', type: 'region', file: '53_Bretagne.png', regionalLabel: 'Bretagne' },
  redon: {
    label: 'CA Redon Agglomération*',
    type: 'epci',
    file: '243500741_CA Redon Agglomération.png',
    regionalLabel: 'Bretagne',
  },
}
const modes: readonly { key: ModeKey; label: string; icon: Component }[] = [
  { key: 'car', label: 'Réseau automobile', icon: CarFront },
  { key: 'walk', label: 'Réseau piéton', icon: Footprints },
  { key: 'bike', label: 'Réseau cyclable', icon: Bike },
]
const modeToEvidence: Readonly<Record<ModeKey, SharingNetworksEvidence['networks'][number]['mode']>> = {
  walk: 'walkTransit',
  bike: 'bike',
  car: 'car',
}
const props = defineProps<{
  evidence?: SharingNetworksEvidence | null
  cyclingEvidence?: CyclingOfferEvidence | null
  sectionNumber?: string
  sources?: readonly string[]
  tagline?: string | null
  explorationTo?: RouteLocationRaw | null
}>()
const activeMode = ref<ModeKey | null>(null)
const tooltipTop = ref<string | null>(null)
const mapMetadata = ref<MapMetadata | null>(null)
const gallerySource = ref<HTMLElement | null>(null)
const galleryInstance = shallowRef<Viewer | null>(null)
const galleryImage = ref<HTMLImageElement | null>(null)
const galleryOpen = ref(false)
const galleryAtNaturalSize = ref(false)
let galleryPointerStart: { x: number; y: number } | null = null
let galleryIgnoreNextClick = false
let galleryIgnoreResetTimer: ReturnType<typeof setTimeout> | null = null

const variant = computed<PlateVariant>(() => {
  const requested = route.query.plate
  return typeof requested === 'string' && variants.includes(requested as PlateVariant)
    ? requested as PlateVariant
    : 'C'
})
const territoryKey = computed<TerritoryKey>(() => {
  const requested = route.query.map
  return typeof requested === 'string' && requested in territories
    ? requested as TerritoryKey
    : 'rennes'
})
const territory = computed(() => territories[territoryKey.value])
const territoryLabel = computed(() => territory.value.label.replace(/\*$/, ''))
const borderLegendEntries = computed<readonly FigureLegendEntry[]>(() => [
  { key: 'territory-boundary', label: territoryLabel.value, marker: 'line' },
  ...(territoryLabel.value === territory.value.regionalLabel
    ? []
    : [{ key: 'regional-frontier', label: territory.value.regionalLabel, marker: 'dash' as const }]),
])
const borderLegendColors: Readonly<Record<string, string>> = {
  'territory-boundary': 'var(--cahier-default)',
  'regional-frontier': 'var(--cahier-default)',
}

function modeLabel(mode: ModeKey): string {
  return props.evidence?.networks.find((network) => network.mode === modeToEvidence[mode])?.label
    ?? modes.find((candidate) => candidate.key === mode)?.label
    ?? 'Réseau'
}

function networkFor(mode: ModeKey) {
  return props.evidence?.networks.find((network) => network.mode === modeToEvidence[mode]) ?? null
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

const cyclingBreakdownAvailable = computed(() => [
  numericContentFact(props.cyclingEvidence?.protectedDensity ?? null),
  numericContentFact(props.cyclingEvidence?.sharedDensity ?? null),
].some((value) => value !== null && value > 0))

function numericContentFact(fact: { fact: { value: number | null } } | null): number | null {
  return fact?.fact.value !== null && fact?.fact.value !== undefined && Number.isFinite(fact.fact.value)
    ? Math.max(0, fact.fact.value)
    : null
}

const networkScale = computed(() => Math.max(
  1,
  ...(props.evidence?.networks.flatMap((network) => [
    numericContentFact(network.length) ?? 0,
    network.length.fact.comparison?.reference?.value ?? 0,
  ]) ?? [0]),
  ...(props.cyclingEvidence ? [
    numericContentFact(props.cyclingEvidence.protectedDensity) ?? 0,
    numericContentFact(props.cyclingEvidence.sharedDensity) ?? 0,
  ] : []),
))

function modeTone(mode: ModeKey): 't' | 'b' | 'c' {
  return mode === 'car' ? 'c' : mode === 'bike' ? 'b' : 't'
}

function modeColor(mode: ModeKey): string {
  return mode === 'car'
    ? 'var(--cahier-mode-car)'
    : mode === 'bike'
      ? 'var(--cahier-mode-bike)'
      : 'var(--cahier-mode-foot)'
}

function modeIcon(mode: ModeKey): Component {
  return modes.find((candidate) => candidate.key === mode)?.icon ?? CarFront
}

function networkTooltipRows(mode: ModeKey): readonly CahierTooltipRow[] {
  const network = networkFor(mode)
  if (!network) return []
  const rows: CahierTooltipRow[] = [{
    label: network.label,
    value: network.length.fact.value === null ? '—' : formatNumber(network.length.fact.value, 2),
    tone: modeTone(mode),
    icon: modeIcon(mode),
  }]
  if (mode === 'bike' && props.cyclingEvidence) {
    rows.push(
      {
        label: props.cyclingEvidence.protectedDensity.label.split(' — ')[0] ?? props.cyclingEvidence.protectedDensity.label,
        value: props.cyclingEvidence.protectedDensity.fact.value === null
          ? '—'
          : formatNumber(props.cyclingEvidence.protectedDensity.fact.value, 2),
        tone: 'b',
        note: comparisonNoteFor(props.cyclingEvidence.protectedDensity),
      },
      {
        label: props.cyclingEvidence.sharedDensity.label.split(' — ')[0] ?? props.cyclingEvidence.sharedDensity.label,
        value: props.cyclingEvidence.sharedDensity.fact.value === null
          ? '—'
          : formatNumber(props.cyclingEvidence.sharedDensity.fact.value, 2),
        tone: 'b',
        note: comparisonNoteFor(props.cyclingEvidence.sharedDensity),
      },
    )
  }
  const reference = network.length.fact.comparison?.reference
  if (reference?.value !== null && reference?.value !== undefined) {
    rows.push({
      label: 'Groupe comparé',
      value: formatNumber(reference.value, 2),
      marker: 'dot',
      markerColor: 'var(--cahier-region-emphasis)',
    })
  }
  return rows
}

function comparisonNoteFor(fact: CyclingOfferEvidence['protectedDensity']): string | undefined {
  const reference = fact.fact.comparison?.reference
  return reference?.value === null || reference?.value === undefined
    ? undefined
    : `${props.evidence?.comparisonLabel ?? 'Groupe comparé'} : ${formatNumber(reference.value, 2)}`
}

const networkBarUnit = computed(() => networkFor('bike')?.length.fact.unit ?? networkFor('car')?.length.fact.unit ?? '')
const roadSurfaceRows = computed<readonly CahierNetworkBarRow[]>(() => {
  const roadSurface = props.evidence?.roadSurface
  const value = numericContentFact(roadSurface ?? null)
  const referenceValue = roadSurface?.fact.comparison?.reference?.value ?? null
  return roadSurface
    ? [{
      key: 'road-surface',
      label: roadSurface.label,
      value: value === null ? '—' : formatNumber(value * 100, 1),
      numericValue: value,
      color: 'var(--cahier-theme-strong)',
      tone: 'neutral',
      colorValue: false,
      markerValue: referenceValue,
      ariaLabel: `${roadSurface.label} : ${value === null ? '—' : formatNumber(value * 100, 1)} %`,
    }]
    : []
})
const networkBarRows = computed<readonly CahierNetworkBarRow[]>(() => modes.map((modeDefinition) => {
  const mode = modeDefinition.key
  const network = networkFor(mode)
  const value = numericContentFact(network?.length ?? null)
  const markerValue = network?.length.fact.comparison?.reference?.value ?? null
  const segments = mode === 'bike' && props.cyclingEvidence
    ? [
      {
        key: 'protected',
        label: 'Protégé',
        value: numericContentFact(props.cyclingEvidence.protectedDensity),
        color: 'var(--cahier-cycle-protected)',
      },
      {
        key: 'shared',
        label: 'Partagé',
        value: numericContentFact(props.cyclingEvidence.sharedDensity),
        color: 'var(--cahier-cycle-shared)',
      },
    ] as const
    : undefined
  return {
    key: mode,
    label: modeLabel(mode),
    value: value === null ? '—' : formatNumber(value, 2),
    numericValue: value,
    color: modeColor(mode),
    tone: modeTone(mode)!,
    icon: modeIcon(mode),
    segments,
    useSegments: mode === 'bike' && cyclingBreakdownAvailable.value,
    colorValue: true,
    markerValue,
    ariaLabel: `${modeLabel(mode)} : ${value === null ? '—' : formatNumber(value, 2)} ${networkBarUnit.value}`,
  }
}))
const figureLectureBlocks = computed(() => [
  ...(props.evidence?.roadSurfaceLecture ?? []),
  ...(props.evidence?.figureLecture ?? []),
])
const hasFigureLecture = computed(() => figureLectureBlocks.value.length > 0 || Boolean(props.sources?.length))

function removeGalleryImageClick(): void {
  galleryImage.value?.removeEventListener('click', onGalleryImageClick)
  galleryImage.value?.removeEventListener('pointerdown', onGalleryPointerDown)
  stopGalleryPointerTracking()
  if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
  galleryIgnoreResetTimer = null
  galleryIgnoreNextClick = false
  galleryImage.value = null
}

function stopGalleryPointerTracking(): void {
  document.removeEventListener('pointermove', onGalleryPointerMove)
  document.removeEventListener('pointerup', onGalleryPointerUp)
  document.removeEventListener('pointercancel', onGalleryPointerUp)
  galleryPointerStart = null
}

function onGalleryPointerDown(event: PointerEvent): void {
  galleryPointerStart = { x: event.clientX, y: event.clientY }
  galleryIgnoreNextClick = false
  document.addEventListener('pointermove', onGalleryPointerMove)
  document.addEventListener('pointerup', onGalleryPointerUp)
  document.addEventListener('pointercancel', onGalleryPointerUp)
}

function onGalleryPointerMove(event: PointerEvent): void {
  if (!galleryPointerStart) return
  if (Math.hypot(event.clientX - galleryPointerStart.x, event.clientY - galleryPointerStart.y) > 3) {
    galleryIgnoreNextClick = true
  }
}

function onGalleryPointerUp(): void {
  stopGalleryPointerTracking()
  if (!galleryIgnoreNextClick) return
  if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
  galleryIgnoreResetTimer = setTimeout(() => {
    galleryIgnoreNextClick = false
    galleryIgnoreResetTimer = null
  }, 0)
}

function onGalleryImageClick(event: MouseEvent): void {
  const gallery = galleryInstance.value
  const image = galleryImage.value
  if (!gallery || !image) return
  if (galleryIgnoreNextClick) {
    galleryIgnoreNextClick = false
    if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
    galleryIgnoreResetTimer = null
    return
  }
  if (galleryAtNaturalSize.value) {
    gallery.reset()
    galleryAtNaturalSize.value = false
    image.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
    return
  }
  const canvas = image.closest('.viewer-canvas')
  const canvasRect = canvas?.getBoundingClientRect()
  gallery.zoomTo(1, true, {
    x: event.clientX - (canvasRect?.left ?? 0),
    y: event.clientY - (canvasRect?.top ?? 0),
  })
  galleryAtNaturalSize.value = true
  image.closest('.viewer-container')?.classList.add('lusk-map-gallery--zoomed')
}

function onGalleryViewed(event: Viewer.ViewedEvent): void {
  removeGalleryImageClick()
  galleryImage.value = event.detail.image
  galleryImage.value.addEventListener('click', onGalleryImageClick)
  galleryImage.value.addEventListener('pointerdown', onGalleryPointerDown)
  galleryAtNaturalSize.value = false
  galleryImage.value.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
}

function onGalleryHidden(): void {
  galleryOpen.value = false
  galleryAtNaturalSize.value = false
  galleryImage.value?.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
  removeGalleryImageClick()
}

function galleryIndexFor(mode: ModeKey): number {
  return modes.findIndex((candidate) => candidate.key === mode)
}

const sharedScaleLabel = computed(() => {
  const scale = mapMetadata.value?.scale
  return scale?.total && scale.units
    ? `${formatNumber(scale.total, scale.units === 'km' ? 1 : 0)} ${scale.units}`
    : 'Échelle commune'
})

const sharedScaleWidth = computed(() => {
  const total = mapMetadata.value?.scale?.total
  if (!total || total <= 0) return '92px'
  const width = Math.min(132, Math.max(76, 76 + Math.log2(total) * 20))
  return `${Math.round(width)}px`
})

function isModeKey(value: string): value is ModeKey {
  return value === 'car' || value === 'walk' || value === 'bike'
}

function setActiveMode(mode: string, event?: Event): void {
  if (!isModeKey(mode)) return
  activeMode.value = mode
  const target = event?.currentTarget
  const apparatus = target instanceof HTMLElement ? target.closest('.plate-apparatus') : null
  if (target instanceof HTMLElement && apparatus instanceof HTMLElement) {
    const targetRect = target.getBoundingClientRect()
    const apparatusRect = apparatus.getBoundingClientRect()
    tooltipTop.value = `${Math.max(0, Math.round(targetRect.top - apparatusRect.top))}px`
  }
}

function clearActiveMode(): void {
  activeMode.value = null
  tooltipTop.value = null
}

function mapUrl(mode: ModeKey): string {
  const selected = territory.value
  return `/@fs/E:/Lusk/pipeline/maps/${selected.type}/${mode}/${encodeURIComponent(selected.file)}`
}

async function loadMapMetadata(): Promise<void> {
  mapMetadata.value = null
  try {
    const response = await fetch(`${mapUrl('car').replace(/\.png$/, '')}.json`)
    if (!response.ok) return
    mapMetadata.value = await response.json() as MapMetadata
  } catch {
    // The prototype also works with pre-metadata map assets.
  }
}

function replaceQuery(next: Record<string, string>): void {
  router.replace({ query: { ...route.query, ...next } })
}

function selectVariant(next: PlateVariant): void {
  replaceQuery({ plate: next })
}

function cycle(direction: -1 | 1): void {
  const current = variants.indexOf(variant.value)
  selectVariant(variants[(current + direction + variants.length) % variants.length]!)
}

function inspect(mode: ModeKey): void {
  galleryInstance.value?.view(galleryIndexFor(mode))
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
  if (galleryOpen.value) return
  if (event.key === 'ArrowLeft') cycle(-1)
  if (event.key === 'ArrowRight') cycle(1)
}

onMounted(() => {
  if (gallerySource.value) {
    galleryInstance.value = new Viewer(gallerySource.value, {
      backdrop: true,
      button: true,
      className: 'lusk-map-gallery',
      fullscreen: false,
      initialCoverage: 0.9,
      navigation: true,
      navbar: { show: true, size: 'large', visibleItemCount: modes.length },
      rotatable: false,
      scalable: false,
      slideOnWheel: false,
      title: [1, (image) => image.alt],
      toggleOnDblclick: false,
      toolbar: false,
      transition: { move: false, zoom: true },
      viewed: onGalleryViewed,
      shown: () => { galleryOpen.value = true },
      hidden: onGalleryHidden,
    })
  }
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  removeGalleryImageClick()
  galleryInstance.value?.destroy()
  galleryInstance.value = null
})
watch(territoryKey, () => {
  void loadMapMetadata()
  void nextTick(() => galleryInstance.value?.update())
}, { immediate: true })
</script>

<template>
  <figure class="map-breakout" :class="`map-breakout--${variant.toLowerCase()}`">
    <CahierFigureFrame size="wide">
      <div class="plate" :aria-label="`${variantLabels[variant]} — trois réseaux à ${territory.label}`">
        <div v-if="variant === 'C'" class="plate-header">
          <div class="plate-apparatus-heading">
            <span v-if="props.sectionNumber" class="map-section-number">{{ props.sectionNumber }}</span>
            <div>
              <h3>{{ props.evidence?.frameTitle ?? 'Réseaux' }}</h3>
              <p class="map-breakout-tagline">{{ props.tagline ?? 'Trois réseaux, trois empreintes' }}</p>
            </div>
          </div>
        </div>

        <div class="cahier-figure-title cahier-baseline-anchor" role="heading" aria-level="3">
          {{ props.evidence?.figureTitle ?? 'Cartes des réseaux de mobilité, par mode' }}
        </div>

        <section
          v-for="(mode, index) in modes"
          :key="mode.key"
          class="map-panel"
          :class="[
            `map-panel--${mode.key}`,
            { 'map-panel--active': activeMode === mode.key, 'map-panel--dimmed': activeMode !== null && activeMode !== mode.key },
          ]"
          @mouseenter="setActiveMode(mode.key)"
          @mouseleave="clearActiveMode"
        >
          <div class="map-panel-label" aria-hidden="true">
            <component :is="mode.icon" :size="16" :stroke-width="1.8" />
            <span>{{ modeLabel(mode.key) }}</span>
          </div>
          <button
            type="button"
            class="map-viewport"
            :aria-label="`Agrandir : ${modeLabel(mode.key)} à ${territory.label}`"
            @focus="setActiveMode(mode.key)"
            @blur="clearActiveMode"
            @click="inspect(mode.key)"
          >
            <span class="map-panel-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
            <img :src="mapUrl(mode.key)" :alt="`${modeLabel(mode.key)} à ${territory.label}`" />
          </button>
        </section>

        <div v-if="variant === 'C'" class="plate-keys">
          <CahierFigureLegend
            class="border-legend"
            :entries="borderLegendEntries"
            :mark-colors="borderLegendColors"
            label="Limites cartographiées"
          />
          <div class="plate-orientation">
            <span class="north-symbol" aria-label="Nord">
              <strong>N</strong>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 11V2M3 5l3-3 3 3" /></svg>
            </span>
            <div class="shared-scale" aria-label="Échelle identique sur les trois cartes">
              <span aria-hidden="true" :style="{ width: sharedScaleWidth }" />
              <small>{{ sharedScaleLabel }}</small>
            </div>
          </div>
        </div>

        <aside v-if="variant === 'C'" class="plate-apparatus">
          <div v-if="props.evidence?.roadSurface" class="plate-subfigure plate-subfigure--road">
            <CahierNetworkBarChart
              :rows="roadSurfaceRows"
              :maximum="1"
              unit="%"
              :reference-label="props.evidence?.comparisonLabel ? 'Groupe comparé' : null"
              aria-label="Emprise routière"
            />
          </div>
          <div class="plate-subfigure plate-subfigure--networks">
            <CahierNetworkBarChart
              :rows="networkBarRows"
              :maximum="networkScale"
              :unit="networkBarUnit"
              :aria-label="props.evidence?.networkReadingsLabel ?? 'Longueur du réseau par habitant'"
              :active-key="activeMode"
              @activate="setActiveMode"
              @deactivate="clearActiveMode"
            />
          </div>
          <CahierFigureTooltip
            v-if="activeMode && networkFor(activeMode)"
            id="map-network-tooltip"
            class="plate-network-tooltip"
            :class="[`plate-network-tooltip--${activeMode}`]"
            :style="tooltipTop ? { '--plate-network-tooltip-top': tooltipTop } : undefined"
            :title="modeLabel(activeMode ?? 'car')"
            :unit="networkBarUnit"
            :rows="networkTooltipRows(activeMode ?? 'car')"
          />
          <CahierFigureLecture v-if="hasFigureLecture">
            <CahierProse v-if="figureLectureBlocks.length > 0" :blocks="figureLectureBlocks" />
            <p v-if="props.sources?.length" class="plate-sources">Sources : {{ props.sources.join(' · ') }}</p>
          </CahierFigureLecture>
          <PassarelleExploration
            v-if="props.explorationTo"
            class="plate-exploration"
            :to="props.explorationTo"
            libelle="En savoir plus"
          />
        </aside>
      </div>
    </CahierFigureFrame>
     <CahierFigureLecture v-if="variant === 'A' && hasFigureLecture">
       <CahierProse v-if="figureLectureBlocks.length > 0" :blocks="figureLectureBlocks" />
       <p v-if="props.sources?.length" class="plate-sources">Sources : {{ props.sources.join(' · ') }}</p>
     </CahierFigureLecture>
    <CahierFigureLegend
      v-if="variant === 'A'"
      class="border-legend border-legend--a"
      :entries="borderLegendEntries"
      :mark-colors="borderLegendColors"
      label="Limites cartographiées"
    />
  </figure>

  <div ref="gallerySource" class="map-gallery-source" aria-hidden="true">
    <img
      v-for="mode in modes"
      :key="mode.key"
      :src="mapUrl(mode.key)"
      :alt="`${modeLabel(mode.key)} à ${territory.label}`"
    />
  </div>

  <nav class="plate-switcher" aria-label="Variantes du prototype cartographique">
    <button type="button" aria-label="Variante précédente" @click="cycle(-1)"><ChevronLeft :size="16" aria-hidden="true" /></button>
    <span><strong>{{ variant }}</strong> — {{ variantLabels[variant] }}</span>
    <button type="button" aria-label="Variante suivante" @click="cycle(1)"><ChevronRight :size="16" aria-hidden="true" /></button>
  </nav>
</template>

<style scoped>
.map-breakout {
  --cahier-cycle-protected: var(--cahier-mode-bike);
  --cahier-cycle-shared: #8c4c9e;
  margin: 0;
  padding: 0 0 var(--space-3);
}

.map-section-number {
  display: inline-block;
  margin-right: 10px;
  color: var(--red);
  font-family: var(--font-sans);
  font-size: .55em;
  font-variant-numeric: tabular-nums;
  letter-spacing: .08em;
  vertical-align: .2em;
}

.map-breakout-tagline {
  margin: 4px 0 0;
  color: var(--muted);
  font-family: var(--font-serif);
  font-size: clamp(1.05rem, 1.8vw, 1.45rem);
  font-style: italic;
  line-height: 1.35;
}

.plate-switcher button:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 2px;
}

.plate {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.map-panel {
  min-width: 0;
  margin: 0;
  transition: opacity 150ms ease-out;
}

.map-panel--dimmed { opacity: .46; }
.map-panel--active { opacity: 1; }

.map-panel-label {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 28px;
  margin-bottom: 6px;
  color: var(--mode-ring);
  font: 700 10px/1.2 var(--font-sans);
  letter-spacing: .035em;
  text-transform: uppercase;
}

.map-breakout--c .map-panel-label { justify-content: center; }

.map-panel-number {
  position: absolute;
  z-index: 1;
  top: 9px;
  left: 11px;
  color: var(--cahier-theme-strong);
  text-shadow: 0 1px 4px var(--paper);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  letter-spacing: .08em;
}

.map-panel--car .map-panel-number { color: var(--cahier-mode-car); }
.map-panel--walk .map-panel-number { color: var(--cahier-mode-foot); }
.map-panel--bike .map-panel-number { color: var(--cahier-mode-bike); }

.map-viewport {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.map-viewport:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 3px;
}

.map-panel img {
  display: block;
  width: 100%;
  height: auto;
  border: 3px solid var(--mode-ring);
  background: #f8fbfb;
}

.map-breakout--a .plate {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
}

.map-breakout--a .plate > .cahier-figure-title { grid-column: 1 / -1; }

.map-panel--car { --mode-ring: var(--cahier-mode-car); }
.map-panel--walk { --mode-ring: var(--cahier-mode-foot); }
.map-panel--bike { --mode-ring: var(--cahier-mode-bike); }

.map-breakout--c .plate {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-areas:
    'header header header'
    'title title title'
    'car walk bike'
    'keys keys keys'
    'apparatus apparatus apparatus';
  gap: clamp(var(--space-4), 3vw, var(--space-8));
  align-items: center;
}

.map-breakout--c .map-panel--walk { grid-area: walk; }
.map-breakout--c .map-panel--bike { grid-area: bike; }
.map-breakout--c .map-panel--car { grid-area: car; }
.map-breakout--c .plate-header { grid-area: header; }
.map-breakout--c .plate > .cahier-figure-title { grid-area: title; }
.map-breakout--c .plate-apparatus { grid-area: apparatus; }
.map-breakout--c .plate-keys { grid-area: keys; }

.map-breakout--c .map-panel {
  width: min(100%, 360px);
  justify-self: center;
}

.map-breakout--c .map-viewport {
  position: relative;
  display: grid;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border: 4px solid var(--mode-ring);
  border-radius: 50%;
  background: color-mix(in srgb, var(--cahier-theme) 8%, var(--paper));
}

.map-breakout--c .map-panel img {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: inherit;
  object-fit: cover;
}

.map-breakout--c .map-panel--bike .map-viewport {
  border-color: transparent;
  background: linear-gradient(var(--paper), var(--paper)) padding-box,
    linear-gradient(135deg, var(--cahier-cycle-protected), var(--cahier-cycle-shared)) border-box;
}

.plate-apparatus {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  padding: var(--space-3) clamp(var(--space-2), 3vw, var(--space-8));
}

.plate-header {
  display: grid;
  gap: var(--space-3);
  align-items: end;
  padding: var(--space-2) clamp(var(--space-2), 3vw, var(--space-8)) 0;
}

.plate-apparatus-heading {
  display: flex;
  gap: 14px;
  align-items: baseline;
  justify-content: center;
  text-align: center;
}

.plate-apparatus-heading > .map-section-number {
  margin-right: 0;
  color: var(--red);
  font-size: 13px;
  letter-spacing: .08em;
  vertical-align: baseline;
}

.plate-apparatus-heading > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.plate-apparatus-heading h3 {
  margin: 0;
  color: var(--cahier-theme-strong);
  font: 700 10px/1.2 var(--font-sans);
  letter-spacing: .08em;
  text-transform: uppercase;
}

.plate-apparatus-heading .map-breakout-tagline {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(1.05rem, 1.4vw, 1.35rem);
  font-style: italic;
  line-height: 1.15;
  text-wrap: balance;
}

.plate-subfigure,
.plate-exploration,
.cahier-figure-lecture {
  grid-column: 1 / -1;
}

.plate-subfigure {
  min-width: 0;
}

.plate-subfigure--road {
  padding-bottom: var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--cahier-theme) 22%, var(--paper));
}

.plate-subfigure--networks {
  padding-top: var(--space-1);
}

.border-legend {
  gap: 6px 12px;
  margin: 0;
  font-size: 9px;
}

.border-legend--a { margin-top: var(--space-3); }

.plate-keys {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-6);
  align-items: center;
  padding-top: var(--space-2);
  border-top: 1px solid color-mix(in srgb, var(--cahier-theme) 22%, var(--paper));
}

.plate-network-tooltip {
  top: var(--plate-network-tooltip-top, 0px);
  right: 0;
  width: min(300px, calc(100vw - 40px));
  max-width: 100%;
  pointer-events: none;
}

.plate-network-tooltip--car { --plate-network-tooltip-top: 145px; }
.plate-network-tooltip--walk { --plate-network-tooltip-top: 193px; }
.plate-network-tooltip--bike {
  --plate-network-tooltip-top: 241px;
  width: min(340px, calc(100vw - 40px));
}

.plate-exploration {
  --passarelle-couleur: var(--red);
  --passarelle-survol: var(--red-dark, var(--red));
}

.plate-orientation {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: center;
  color: var(--cahier-theme-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.plate-keys .plate-orientation { margin: 0; }

.north-symbol {
  display: grid;
  justify-items: center;
  gap: 1px;
  width: 16px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1;
}

.north-symbol strong { font-weight: 700; }
.north-symbol svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.3;
}

.shared-scale {
  display: grid;
  gap: 3px;
  justify-items: end;
}

.shared-scale > span {
  width: 92px;
  height: 7px;
  border-right: 1px solid currentColor;
  border-bottom: 2px solid currentColor;
  border-left: 1px solid currentColor;
}

.shared-scale small { font-size: 8px; font-weight: 600; letter-spacing: .04em; }

.map-gallery-source {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

:global(.lusk-map-gallery.viewer-container) {
  z-index: 2015;
  color: #fff;
  background: #18201f;
}

:global(.lusk-map-gallery .viewer-canvas) {
  background: #18201f;
}

:global(.lusk-map-gallery .viewer-canvas > img) {
  cursor: zoom-in;
  touch-action: none;
}

:global(.lusk-map-gallery--zoomed .viewer-canvas > img) { cursor: grab; }
:global(.lusk-map-gallery .viewer-footer) { background: linear-gradient(transparent, rgb(24 31 30 / 94%)); }
:global(.lusk-map-gallery .viewer-title) { color: #fff; font: 600 12px/1.25 var(--font-sans); }
:global(.lusk-map-gallery .viewer-navbar) { background: rgb(24 31 30 / 86%); }
:global(.lusk-map-gallery .viewer-button) { background-color: rgb(24 31 30 / 72%); }
:global(.lusk-map-gallery .viewer-button:hover),
:global(.lusk-map-gallery .viewer-button:focus) { background-color: rgb(24 31 30 / 96%); }
:global(.lusk-map-gallery .viewer-prev),
:global(.lusk-map-gallery .viewer-next) { background-color: rgb(24 31 30 / 72%); }
:global(.lusk-map-gallery .viewer-prev:hover),
:global(.lusk-map-gallery .viewer-next:hover) { background-color: rgb(24 31 30 / 96%); }

.plate-switcher {
  position: fixed;
  right: var(--space-5);
  bottom: 76px;
  z-index: 1399;
  display: grid;
  grid-template-columns: 34px auto 34px;
  align-items: center;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 999px;
  color: #fff;
  background: #232a2a;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font: 600 12px/1 var(--font-sans);
}

.plate-switcher button {
  min-height: 34px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.plate-switcher button:hover { background: rgb(255 255 255 / 10%); }
.plate-switcher span { padding: 0 4px; }
.plate-switcher strong { color: #cce3de; }

@media (max-width: 760px) {
  .map-breakout { padding-inline: 0; }
  .map-breakout--a .plate,
  .map-breakout--c .plate { grid-template-columns: 1fr; }
  .map-breakout--c .plate { grid-template-areas: 'header' 'title' 'car' 'walk' 'bike' 'keys' 'apparatus'; }
  .plate-apparatus { padding-inline: 0; }
  .map-breakout--c .map-viewport { max-width: 520px; margin-inline: auto; }
  .map-breakout--c .plate-keys { grid-template-columns: 1fr; }
  .plate-switcher { right: 50%; transform: translateX(50%); }
}
</style>
