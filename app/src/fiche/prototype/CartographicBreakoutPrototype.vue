<script setup lang="ts">
/**
 * [PROTOTYPE JETABLE] Two ways a cartographic breakout could interrupt the
 * Production Atlas circulaire plate for the Mobilité cahier.
 */
import { Bike, CarFront, Footprints } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { mapAssetUrl } from '@/fiche/mapAssetUrl'

import type { CahierTooltipRow, FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_MAP_LAYOUT_STYLE } from '@/fiche/cahierFigureGrammaire'
import type { CyclingOfferEvidence, SharingNetworksEvidence } from '@/fiche/content/themeContent'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierProse from './CahierProse.vue'
import CahierComparisonNote from './CahierComparisonNote.vue'
import type { CahierNetworkBarRow } from './CahierNetworkBarChart.vue'
import CahierNetworkBarChart from './CahierNetworkBarChart.vue'
import CahierMapGallery from './CahierMapGallery.vue'
import CahierMapPanel from './CahierMapPanel.vue'

type ModeKey = 'walk' | 'bike' | 'car'

const props = defineProps<{ territory: { code: string; name: string }; evidence?: SharingNetworksEvidence | null; cyclingEvidence?: CyclingOfferEvidence | null; sectionNumber?: string; sources?: readonly string[]; tagline?: string | null; explorationTo?: RouteLocationRaw | null }>()

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
const activeMode = ref<ModeKey | null>(null)
const tooltipTop = ref<string | null>(null)
const mapGallery = ref<InstanceType<typeof CahierMapGallery> | null>(null)

const territoryLabel = computed(() => props.territory.name)
const borderLegendEntries = computed<readonly FigureLegendEntry[]>(() => [{ key: 'territory-boundary', label: territoryLabel.value, marker: 'line' }])
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

const inspectionModes = computed(() => modes.filter((mode) => {
  const network = networkFor(mode.key)
  return network !== null && network.length.fact.value !== 0 && !unavailableInspectionModes.value.has(mode.key)
}))
const inspectionImages = computed(() => inspectionModes.value.map((mode) => ({
  key: mode.key,
  src: inspectionUrl(mode.key),
  alt: `${modeLabel(mode.key)} — ${props.territory.name}`,
})))

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
  return mapAssetUrl(props.territory.code, mode, 'inline')
}

function inspectionUrl(mode: ModeKey): string { return mapAssetUrl(props.territory.code, mode, 'inspection') }

const unavailableInlineModes = ref(new Set<ModeKey>())
const loadedInlineModes = ref(new Set<ModeKey>())
const unavailableInspectionModes = ref(new Set<ModeKey>())
const failedInspectionMode = ref<ModeKey | null>(null)
function inlineLoaded(mode: ModeKey): void { loadedInlineModes.value = new Set(loadedInlineModes.value).add(mode) }
function inlineFailed(mode: ModeKey): void { unavailableInlineModes.value = new Set([...unavailableInlineModes.value, mode]) }
function inspectionFailed(key: string): void {
  if (!isModeKey(key)) return
  const mode = key
  unavailableInspectionModes.value = new Set([...unavailableInspectionModes.value, mode])
  failedInspectionMode.value = mode
}

async function inspect(mode: ModeKey): Promise<void> {
  const length = numericContentFact(networkFor(mode)?.length ?? null)
  if (length === null || length === 0) {
    failedInspectionMode.value = mode
    return
  }
  failedInspectionMode.value = null
  const opened = await mapGallery.value?.open(mode)
  if (!opened) failedInspectionMode.value = mode
}
</script>

<template>
  <figure class="map-breakout map-breakout--c">
    <CahierFigureFrame size="wide">
      <div class="plate cahier-map-grid" :style="CAHIER_MAP_LAYOUT_STYLE" :aria-label="`Atlas circulaire — trois réseaux à ${props.territory.name}`">
        <div class="plate-header">
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
          <CahierMapPanel
            :image-url="mapUrl(mode.key)"
            :image-alt="`${modeLabel(mode.key)} — ${props.territory.name}`"
            :accessible-name="`Agrandir : ${modeLabel(mode.key)} à ${props.territory.name}`"
            :number="String(index + 1).padStart(2, '0')"
            :loaded="loadedInlineModes.has(mode.key)"
            :unavailable="unavailableInlineModes.has(mode.key)"
            :cycling="mode.key === 'bike'"
            @focus="setActiveMode(mode.key)"
            @blur="clearActiveMode"
            @loaded="inlineLoaded(mode.key)"
            @unavailable="inlineFailed(mode.key)"
            @inspect="inspect(mode.key)"
          />
        </section>

        <div class="plate-keys">
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
              <span aria-hidden="true" />
            </div>
          </div>
        </div>

        <aside class="plate-apparatus">
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
           <CahierComparisonNote :label="props.evidence?.comparisonLabel ?? null" />
           <PassarelleExploration
            v-if="props.explorationTo"
            class="plate-exploration"
            :to="props.explorationTo"
            libelle="En savoir plus"
          />
        </aside>
      </div>
    </CahierFigureFrame>
  </figure>

  <CahierMapGallery ref="mapGallery" :images="inspectionImages" @unavailable="inspectionFailed" />
  <p v-if="failedInspectionMode && numericContentFact(networkFor(failedInspectionMode)?.length ?? null) === 0" role="status" class="inspection-unavailable">Aucune carte détaillée : {{ modeLabel(failedInspectionMode) }} sans réseau recensé.</p>
  <p v-else-if="failedInspectionMode" role="status" class="inspection-unavailable">Carte détaillée indisponible pour {{ modeLabel(failedInspectionMode) }}.</p>

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
  font: var(--text-caption);
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
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
}

.map-breakout--c .map-panel-label { justify-content: center; }

.map-breakout--a .plate {
  grid-template-columns: var(--cahier-map-columns);
  align-items: start;
}

.map-breakout--a .plate > .cahier-figure-title { grid-column: 1 / -1; }

.map-panel--car { --mode-ring: var(--cahier-mode-car); }
.map-panel--walk { --mode-ring: var(--cahier-mode-foot); }
.map-panel--bike { --mode-ring: var(--cahier-mode-bike); }

.map-breakout--c .plate {
  grid-template-columns: var(--cahier-map-columns);
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
  font: var(--text-caption);
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
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
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
  font: var(--text-caption);
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
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
}

.plate-keys .plate-orientation { margin: 0; }

.north-symbol {
  display: grid;
  justify-items: center;
  gap: 1px;
  width: 16px;
  color: var(--muted);
  font-size: var(--type-figure-tick-size);
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

.shared-scale small { font: var(--text-caption); font-weight: 600; letter-spacing: normal; }

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
  .map-breakout--c .map-panel { max-width: 520px; margin-inline: auto; }
  .map-breakout--c .plate-keys { grid-template-columns: 1fr; }
  .plate-switcher { right: 50%; transform: translateX(50%); }
}
</style>
