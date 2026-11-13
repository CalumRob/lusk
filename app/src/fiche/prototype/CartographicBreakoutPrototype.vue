<script setup lang="ts">
/**
 * Maps of the three Mobilité networks (#954).
 *
 * The plate keeps only the three map panels, their mode ring, the inspection
 * gallery and the network/bike tooltips. Prose, source stamps and the compared
 * bars live in the section delegate below the maps.
 */
import { Bike, CarFront, Footprints } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { mapAssetUrl } from '@/fiche/mapAssetUrl'

import type { CahierTooltipComparison, CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_MAP_LAYOUT_STYLE } from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import { formatServedRank, formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import type { ContentFact, MobiliteNetworksEvidence } from '@/fiche/content/themeContent'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierMapGallery from './CahierMapGallery.vue'
import CahierMapPanel from './CahierMapPanel.vue'

type ModeKey = 'walk' | 'bike' | 'car'

const props = defineProps<{
  territory: { code: string; name: string }
  evidence: MobiliteNetworksEvidence | null
}>()

const modes: readonly { key: ModeKey; label: string; icon: Component }[] = [
  { key: 'car', label: 'Réseau automobile', icon: CarFront },
  { key: 'walk', label: 'Réseau piéton', icon: Footprints },
  { key: 'bike', label: 'Réseau cyclable', icon: Bike },
]
const modeToCategory: Readonly<Record<ModeKey, string>> = {
  walk: 'walkTransit',
  bike: 'bike',
  car: 'car',
}
const activeMode = ref<ModeKey | null>(null)
const tooltipTop = ref<string | null>(null)
const mapGallery = ref<InstanceType<typeof CahierMapGallery> | null>(null)

function categoryFor(mode: ModeKey) {
  return props.evidence?.figure.categories.find((category) => category.key === modeToCategory[mode]) ?? null
}

function categoryLabel(mode: ModeKey): string {
  return categoryFor(mode)?.label
    ?? modes.find((candidate) => candidate.key === mode)?.label
    ?? 'Réseau'
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function numericContentFact(fact: { fact: { value: number | null } } | null): number | null {
  return fact?.fact.value !== null && fact?.fact.value !== undefined && Number.isFinite(fact.fact.value)
    ? Math.max(0, fact.fact.value)
    : null
}

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

function comparisonForFact(
  fact: ContentFact,
  scope: string | null,
  unit = '',
  unsplitTotal = false,
): CahierTooltipComparison | undefined {
  const comparison = fact.fact.comparison
  const reference = comparison?.reference
  if (!reference || reference.value === null || reference.value === undefined) return undefined
  const visibleValue = formatNumber(reference.value, 2)
  const ariaValue = `${visibleValue}${unit ? ` ${unit}` : ''}`
  const rank = formatServedRank(comparison.rank)
  const statistic = comparison.reference?.kind === 'mean' ? 'moyenne' : 'médiane'
  const scopeOnly = scope?.replace(/^(?:Médiane|Moyenne) des /u, '') ?? null
  const description = unsplitTotal
    ? `${statistic} du total non segmenté${scopeOnly ? ` — ${scopeOnly}` : ''}`
    : scope ?? statistic
  const direction = comparison.direction ? LIBELLES_DIRECTION[comparison.direction] : null
  const rankAria = puceRangDirection(comparison.rank, comparison.direction)?.phraseAria
    ?? formatServedRankAria(comparison.rank)
  return {
    // Visible values are bare; ARIA keeps the full unit, resolved scope and rank.
    value: visibleValue,
    rank,
    rankEvidence: comparison.rank,
    ariaLabel: `${GROUPE_COMPARE_LABEL} : ${ariaValue} (${description})${rankAria ? `. Rang ${rankAria}` : direction ? `. ${direction}` : ''}`,
  }
}

function networkTooltipRows(mode: ModeKey): readonly CahierTooltipRow[] {
  const category = categoryFor(mode)
  if (!category) return []
  const unit = props.evidence?.figure.unit ?? ''
  const totalLabel = category.key === 'bike' ? 'Total vélo' : category.label
  const rows: CahierTooltipRow[] = [{
    label: totalLabel,
    value: category.value.fact.value === null ? '—' : formatNumber(category.value.fact.value, 2),
    ariaLabel: `${totalLabel} : ${category.value.fact.value === null ? 'Indisponible' : `${formatNumber(category.value.fact.value, 2)} ${unit}`}`,
    tone: modeTone(mode),
    icon: modeIcon(mode),
    markerColor: modeColor(mode),
    comparison: comparisonForFact(category.value, props.evidence?.figure.comparisonLabel ?? null, unit, category.segments.length > 0),
  }]
  if (category.splitNote) {
    rows.push({
      label: 'Répartition Protégé/Partagé',
      value: 'Indisponible',
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: category.splitNote,
    })
  }
  for (const segment of category.segments) {
    rows.push({
      label: segment.label,
      value: segment.value.fact.value === null ? '—' : formatNumber(segment.value.fact.value, 2),
      ariaLabel: `${segment.label} : ${segment.value.fact.value === null ? 'Indisponible' : `${formatNumber(segment.value.fact.value, 2)} ${unit}`}`,
      tone: 'b',
      marker: 'dot',
      markerColor: segment.key === 'protege_km_1000'
        ? 'var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))'
        : 'var(--cahier-cycle-shared, #8c4c9e)',
      comparison: comparisonForFact(segment.value, props.evidence?.figure.comparisonLabel ?? null, unit),
    })
    if (segment.rawValue) {
      rows.push({
        label: segment.rawValue.label,
        value: segment.rawValue.fact.value === null
          ? '—'
          : formatNumber(segment.rawValue.fact.value, 2),
        tone: 'neutral',
        marker: 'slash',
        ariaLabel: `${segment.rawValue.label} : ${segment.rawValue.fact.value === null ? 'indisponible' : `${formatNumber(segment.rawValue.fact.value, 2)} ${segment.rawValue.fact.unit}`} (valeur brute)`,
        comparison: comparisonForFact(
          segment.rawValue,
          props.evidence?.figure.comparisonLabel ?? null,
          segment.rawValue.fact.unit,
        ),
      })
    }
  }
  if (category.rawValue) {
    rows.push({
      label: category.rawValue.label,
      value: category.rawValue.fact.value === null
        ? '—'
        : formatNumber(category.rawValue.fact.value, 2),
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: `${category.rawValue.label} : ${category.rawValue.fact.value === null ? 'indisponible' : `${formatNumber(category.rawValue.fact.value, 2)} ${category.rawValue.fact.unit}`} (valeur brute)`,
      comparison: comparisonForFact(
        category.rawValue,
        props.evidence?.figure.comparisonLabel ?? null,
        category.rawValue.fact.unit,
      ),
    })
  }
  return rows
}

const inspectionModes = computed(() => modes.filter((mode) => {
  const category = categoryFor(mode.key)
  return category !== null && category.value.fact.value !== 0 && !unavailableInspectionModes.value.has(mode.key)
}))
const inspectionImages = computed(() => inspectionModes.value.map((mode) => ({
  key: mode.key,
  src: inspectionUrl(mode.key),
  alt: `${categoryLabel(mode.key)} — ${props.territory.name}`,
})))

function isModeKey(value: string): value is ModeKey {
  return value === 'car' || value === 'walk' || value === 'bike'
}

function setActiveMode(mode: string, event?: Event): void {
  if (!isModeKey(mode)) return
  activeMode.value = mode
  const target = event?.currentTarget
  const plate = target instanceof HTMLElement ? target.closest('.plate') : null
  if (target instanceof HTMLElement && plate instanceof HTMLElement) {
    const targetRect = target.getBoundingClientRect()
    const plateRect = plate.getBoundingClientRect()
    tooltipTop.value = `${Math.max(0, Math.round(targetRect.top - plateRect.top))}px`
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
  const length = numericContentFact(categoryFor(mode)?.value ?? null)
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
        <div class="cahier-figure-title cahier-baseline-anchor" role="heading" aria-level="3">
          {{ props.evidence?.mapFigureTitle ?? 'Cartes des réseaux de mobilité, par mode' }}
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
            <span>{{ categoryLabel(mode.key) }}</span>
          </div>
          <CahierMapPanel
            :image-url="mapUrl(mode.key)"
            :image-alt="`${categoryLabel(mode.key)} — ${props.territory.name}`"
            :accessible-name="`Agrandir : ${categoryLabel(mode.key)} à ${props.territory.name}`"
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

        <CahierFigureTooltip
          v-if="activeMode && categoryFor(activeMode)"
          id="map-network-tooltip"
          class="plate-network-tooltip"
          :class="[`plate-network-tooltip--${activeMode}`]"
          :style="tooltipTop ? { '--plate-network-tooltip-top': tooltipTop } : undefined"
          :title="categoryLabel(activeMode ?? 'car')"
          :rows="networkTooltipRows(activeMode ?? 'car')"
        />
      </div>
    </CahierFigureFrame>
  </figure>

  <CahierMapGallery ref="mapGallery" :images="inspectionImages" @unavailable="inspectionFailed" />
  <p v-if="failedInspectionMode && numericContentFact(categoryFor(failedInspectionMode)?.value ?? null) === 0" role="status" class="inspection-unavailable">Aucune carte détaillée : {{ categoryLabel(failedInspectionMode) }} sans réseau recensé.</p>
  <p v-else-if="failedInspectionMode" role="status" class="inspection-unavailable">Carte détaillée indisponible pour {{ categoryLabel(failedInspectionMode) }}.</p>
</template>

<style src="./cahierMapPanelLabel.css"></style>

<style scoped>
.map-breakout {
  --cahier-cycle-protected: var(--cahier-mode-bike);
  --cahier-cycle-shared: #8c4c9e;
  margin: 0;
  padding: 0 0 var(--space-3);
}

.plate {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: var(--cahier-map-columns);
  grid-template-areas:
    'title title title'
    'car walk bike';
  gap: clamp(var(--space-4), 3vw, var(--space-8));
  align-items: center;
}

.plate > .cahier-figure-title { grid-area: title; }

.map-panel {
  min-width: 0;
  margin: 0;
  transition: opacity 150ms ease-out;
}

.map-panel--walk { grid-area: walk; }
.map-panel--bike { grid-area: bike; }
.map-panel--car { grid-area: car; }

.map-panel--dimmed { opacity: .46; }
.map-panel--active { opacity: 1; }

.map-panel-label {
  margin-bottom: 6px;
  justify-content: center;
}

.plate .map-panel {
  width: min(100%, 360px);
  justify-self: center;
}

.plate-network-tooltip {
  position: absolute;
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

@media (max-width: 760px) {
  .map-breakout { padding-inline: 0; }
  .plate { grid-template-columns: 1fr; grid-template-areas: 'title' 'car' 'walk' 'bike'; }
  .plate .map-panel { max-width: 520px; margin-inline: auto; }
  .map-breakout .map-panel-label { justify-content: center; margin-inline: auto; text-align: center; }
  .map-breakout .map-panel--dimmed { opacity: 1; }
  .map-breakout .map-panel :deep(.map-viewport) { transition: opacity 150ms ease-out; }
  .map-breakout .map-panel--dimmed :deep(.map-viewport) { opacity: .46; }
}
</style>
