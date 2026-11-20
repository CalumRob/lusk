<script setup lang="ts">
import './cahierEvidenceSource.css'
import { Bike, BusFront, CarFront } from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed, ref, watch } from 'vue'

import { CAHIER_MAP_LAYOUT_STYLE } from '@/fiche/cahierFigureGrammaire'
import type { TextBlock } from '@/fiche/content/themeContent'
import { AEDAR_CAR_MAP_HORIZON_MINUTES, aedarCarMapAssetUrl } from '@/fiche/mapAssetUrl'
import { fetchAedarCarMapLegend } from '@/fiche/content/aedarCarMapLegend'
import type { AedarCarMapLegend } from '@/fiche/content/aedarCarMapLegend'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierContinuousMapLegend from './CahierContinuousMapLegend.vue'
import CahierMapGallery from './CahierMapGallery.vue'
import CahierMapPanel from './CahierMapPanel.vue'
import CahierProse from './CahierProse.vue'
import { useCahierExportPublication } from './cahierExportVenue'
import { useCahierNativeRender } from './cahierNativeRenderContext'

const props = withDefaults(defineProps<{
  territory: Pick<TerritoryIdentity, 'type' | 'code' | 'name'>
  horizonMinutes: number
  /** Figure title owned by the semantic content layer (shared figure-title primitive). */
  title: TextBlock
  modeKeys?: readonly ('car' | 'bike-lts2' | 'transit')[]
  /** Reading under the map grid: honest empty state and provisional horizon. */
  lecture?: readonly TextBlock[]
  /** #986 — its AEDAR chapter is the requested one: the legend asset may load. */
  active?: boolean
}>(), { active: true })

const availableSlots: readonly { key: 'car' | 'bike-lts2' | 'transit'; label: string; icon: Component; tone: string }[] = [
  { key: 'car', label: 'Voiture', icon: CarFront, tone: 'car' },
  { key: 'bike-lts2', label: 'Vélo (LTS2)', icon: Bike, tone: 'bike' },
  { key: 'transit', label: 'Transports en commun', icon: BusFront, tone: 'foot' },
]
const slots = computed(() => availableSlots.filter((slot) => !props.modeKeys || props.modeKeys.includes(slot.key)))
const nativeRender = useCahierNativeRender()
const loadedCarMapCodes = ref(new Set<string>())
const unavailableCarMapCodes = ref(new Set<string>())
const mapGallery = ref<InstanceType<typeof CahierMapGallery> | null>(null)
const inspectionUnavailable = ref(false)
const carMapAlternativeText = computed(() => `${props.title.map((segment) => segment.value).join('')} — ${props.territory.name}`)
const carMapGalleryImages = computed(() => props.horizonMinutes === AEDAR_CAR_MAP_HORIZON_MINUTES
  ? [{ key: 'car', src: aedarCarMapAssetUrl(props.territory.code, 'inspection'), alt: carMapAlternativeText.value }]
  : [])
const acquiredLegend = ref<AedarCarMapLegend | null>(null)
const carMapLegend = computed(() => nativeRender ? nativeRender.carMap?.legend ?? null : acquiredLegend.value)
const inlineSrc = computed(() => nativeRender ? nativeRender.carMap?.src : props.active === false
  ? undefined : aedarCarMapAssetUrl(props.territory.code, 'inline'))
const legendStatus = ref<'loading' | 'ready' | 'unavailable'>('loading')
const needsCarMapLegend = computed(() => slots.value.some((slot) => usesCarMap(slot.key))
  && !unavailableCarMapCodes.value.has(props.territory.code))
const showCarMapLegend = computed(() => needsCarMapLegend.value && carMapLegend.value !== null)

let legendIdentity: string | null = null
watch(
  () => [props.territory.type, props.territory.code, props.horizonMinutes, needsCarMapLegend.value,
    props.active !== false].join('|'),
  async (_, __, onCleanup) => {
    if (nativeRender) return
    let current = true
    onCleanup(() => { current = false })
    if (!needsCarMapLegend.value) {
      acquiredLegend.value = null
      legendStatus.value = 'loading'
      legendIdentity = null
      return
    }
    const identity = `${props.territory.type}/${props.territory.code}/${props.horizonMinutes}`
    // A different territory/horizon invalidates the settled legend; merely
    // leaving the chapter keeps it, so returning reuses it without a fetch.
    if (legendIdentity !== null && legendIdentity !== identity) {
      acquiredLegend.value = null
      legendStatus.value = 'loading'
    }
    if (props.active === false) return
    if (legendIdentity === identity && acquiredLegend.value) { legendStatus.value = 'ready'; return }
    acquiredLegend.value = null
    legendStatus.value = 'loading'
    try {
      const legend = await fetchAedarCarMapLegend(props.territory)
      if (current) { acquiredLegend.value = legend; legendStatus.value = 'ready'; legendIdentity = identity }
    } catch {
      if (current) legendStatus.value = 'unavailable'
    }
  },
  { immediate: true },
)

function usesCarMap(slotKey: 'car' | 'bike-lts2' | 'transit'): boolean {
  return slotKey === 'car'
    && props.horizonMinutes === AEDAR_CAR_MAP_HORIZON_MINUTES
}

function slotStateLabel(slotKey: 'car' | 'bike-lts2' | 'transit'): string {
  if (slotKey !== 'car') return 'Carte à venir'
  if (props.horizonMinutes !== AEDAR_CAR_MAP_HORIZON_MINUTES) return 'Carte indisponible pour cet horizon'
  if (unavailableCarMapCodes.value.has(props.territory.code)) return 'Carte indisponible'
  return 'Carte disponible'
}

// #1021 — the car map plate publishes the availability it already tracks.
useCahierExportPublication(() => ({
  owner: 'map-availability',
  state: {
    maps: slots.value.map((slot) => {
      const carMap = usesCarMap(slot.key)
      return {
        id: slot.key,
        label: slot.label,
        declared: carMap,
        loaded: carMap && loadedCarMapCodes.value.has(props.territory.code),
        unavailable: carMap && unavailableCarMapCodes.value.has(props.territory.code),
        // The figure plate renders the inline asset, not the excluded inspection gallery.
        inlineUrl: carMap ? aedarCarMapAssetUrl(props.territory.code, 'inline') : null,
        bytes: carMap ? carMapBytes.value ?? undefined : undefined,
      }
    }),
    legend: showCarMapLegend.value
      ? 'available'
      : needsCarMapLegend.value
        ? (legendStatus.value === 'unavailable' ? 'unavailable' : 'pending')
        : 'none',
    legendDetail: showCarMapLegend.value && carMapLegend.value
      ? {
        title: carMapLegend.value.title,
        minimum: carMapLegend.value.minimum,
        maximum: carMapLegend.value.maximum,
        colors: carMapLegend.value.colors,
        tickLabels: carMapLegend.value.tickLabels,
        note: carMapLegend.value.note,
        ariaLabel: null,
      }
      : null,
  },
}))

const carMapBytes = ref<ArrayBuffer | null>(null)

function markCarMapLoaded(code: string, bytes: ArrayBuffer | null): void {
  loadedCarMapCodes.value = new Set(loadedCarMapCodes.value).add(code)
  if (bytes) carMapBytes.value = bytes
}

function markCarMapUnavailable(code: string): void {
  unavailableCarMapCodes.value = new Set(unavailableCarMapCodes.value).add(code)
}

async function inspectCarMap(): Promise<void> {
  // The pending page-1 surface never opens the gallery before its chapter is
  // requested: that would download the inspection asset for an unrequested page.
  if (nativeRender || props.active === false) return
  inspectionUnavailable.value = !await mapGallery.value?.open('car')
}

function markInspectionUnavailable(): void {
  inspectionUnavailable.value = true
}
</script>

<template>
  <figure class="blank-map-slots">
    <figcaption class="cahier-figure-title cahier-baseline-anchor"><CahierProse :blocks="[props.title]" /></figcaption>
    <div class="blank-map-slots__grid cahier-map-grid" :style="[CAHIER_MAP_LAYOUT_STYLE, slots.length === 1 ? { '--cahier-map-columns': 'minmax(0, 1fr)' } : {}]">
      <section
        v-for="(slot, index) in slots"
        :key="slot.key"
        class="blank-map-slot map-panel"
        :class="[`map-panel--${slot.tone}`, `blank-map-slot--${slot.key}`]"
        :aria-label="`${slot.label} — ${props.territory.name} — ${props.horizonMinutes} minutes — ${slotStateLabel(slot.key)}`"
      >
        <div class="map-panel-label" aria-hidden="true">
          <component :is="slot.icon" :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ slot.label }}</span>
        </div>
        <CahierMapPanel
          v-if="usesCarMap(slot.key)"
          class="blank-map-slot__viewport"
          :style="{ '--mode-ring': `var(--cahier-mode-${slot.tone})` }"
          :image-url="inlineSrc"
          :image-alt="carMapAlternativeText"
          :accessible-name="`Agrandir : ${slot.label} à ${props.territory.name}`"
          :number="String(index + 1).padStart(2, '0')"
          :loaded="loadedCarMapCodes.has(props.territory.code)"
          :unavailable="unavailableCarMapCodes.has(props.territory.code)"
          @loaded="markCarMapLoaded(props.territory.code, $event)"
          @unavailable="markCarMapUnavailable(props.territory.code)"
          @inspect="inspectCarMap"
        />
        <div
          v-else
          class="blank-map-slot__viewport"
          :style="{ '--mode-ring': `var(--cahier-mode-${slot.tone})` }"
          role="img"
          :aria-label="`${slotStateLabel(slot.key)} : ${slot.label} pour ${props.territory.name}`"
        >
          <span class="blank-map-slot__number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="blank-map-slot__state">{{ slotStateLabel(slot.key) }}</span>
          <span class="blank-map-slot__territory">{{ props.territory.name }}</span>
          <span class="blank-map-slot__horizon">{{ props.horizonMinutes }} minutes</span>
        </div>
      </section>
    </div>
    <div
      v-if="showCarMapLegend"
      class="blank-map-slots__legend-grid"
      :style="[CAHIER_MAP_LAYOUT_STYLE, slots.length === 1 ? { '--cahier-map-columns': 'minmax(0, 1fr)' } : {}]"
    >
      <CahierContinuousMapLegend
        class="aedar-car-map-legend"
        :title="carMapLegend!.title"
        :minimum="carMapLegend!.minimum ?? undefined"
        :maximum="carMapLegend!.maximum ?? undefined"
        :colors="carMapLegend!.colors"
        :tick-labels="carMapLegend!.tickLabels"
        :note="carMapLegend!.note"
      />
    </div>
    <p v-else-if="needsCarMapLegend" class="cahier-evidence-source" role="status">
      {{ legendStatus === 'loading' ? 'Chargement des métadonnées de légende AEDAR…' : 'Les métadonnées de légende de la carte AEDAR voiture ne sont pas disponibles.' }}
    </p>
    <CahierFigureLecture v-if="props.lecture && props.lecture.length > 0">
      <CahierProse :blocks="props.lecture" />
    </CahierFigureLecture>
    <CahierMapGallery
      ref="mapGallery"
      :images="carMapGalleryImages"
      @unavailable="markInspectionUnavailable"
    />
    <p v-if="inspectionUnavailable" role="status" class="inspection-unavailable">
      Carte détaillée indisponible pour Voiture — {{ props.territory.name }}.
    </p>
  </figure>
</template>

<style src="./cahierLayout.css"></style>
<style src="./cahierMapPanelLabel.css"></style>

<style scoped>
.blank-map-slots { margin: 0; padding: 0 0 var(--space-3); }
.blank-map-slots__grid { display: grid; grid-template-columns: var(--cahier-map-columns); gap: clamp(var(--space-4), 3vw, var(--space-8)); align-items: center; }
/* The continuous legend is its own measured band below the circular plate:
   at the narrower export figure width its two-line title otherwise sits on the
   ring. Reserve a real gap that scales with the reading width, never a fixed
   8 px that disappears once the figure is projected to A4. */
.blank-map-slots__legend-grid { display: grid; grid-template-columns: var(--cahier-map-columns); gap: clamp(var(--space-4), 3vw, var(--space-8)); margin-top: clamp(18px, 2.4vw, 28px); }
.blank-map-slots__legend-grid > :first-child { grid-column: 1; width: min(100%, 360px); justify-self: center; }
.blank-map-slot { width: min(100%, 360px); justify-self: center; }
.map-panel-label { justify-content: center; margin: 0 0 6px; }
.blank-map-slot__viewport { position: relative; display: grid; width: 100%; aspect-ratio: 1; place-content: center; justify-items: center; gap: 8px; overflow: hidden; border: var(--cahier-map-circle-border) solid var(--mode-ring); border-radius: 50%; background: color-mix(in srgb, var(--cahier-theme) 8%, var(--paper)); color: var(--ink); text-align: center; }
.blank-map-slot__number { position: absolute; top: 9px; left: 11px; color: var(--mode-ring); font: var(--text-caption); font-variant-numeric: tabular-nums; }
.blank-map-slot__state { font: var(--text-caption); font-weight: 700; }
.blank-map-slot__territory, .blank-map-slot__horizon { color: var(--muted); font: var(--text-caption); }
@media (max-width: 760px) { .blank-map-slots__grid, .blank-map-slots__legend-grid { grid-template-columns: 1fr; } .blank-map-slot { width: min(100%, 520px); } .map-panel-label { margin-inline: auto; } }
</style>
