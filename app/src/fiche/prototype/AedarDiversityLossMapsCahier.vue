<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bike, BusFront, Footprints } from 'lucide-vue-next'
import type { Component } from 'vue'

import { CAHIER_MAP_LAYOUT_STYLE } from '@/fiche/cahierFigureGrammaire'
import { aedarDiversityLossMapAssetUrl } from '@/fiche/mapAssetUrl'
import type { AedarDiversityLossEvidence, AedarDiversityLossMapEvidence } from '@/fiche/content/themeContent'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import CahierContinuousMapLegend from './CahierContinuousMapLegend.vue'
import CahierMapGallery from './CahierMapGallery.vue'
import CahierMapPanel from './CahierMapPanel.vue'
import CahierProse from './CahierProse.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'

const props = defineProps<{
  evidence: AedarDiversityLossEvidence
}>()

const modePresentation: Readonly<Record<AedarDiversityLossMapEvidence['mode'], { icon: Component; tone: 'foot' | 'bike' }>> = {
  walk: { icon: Footprints, tone: 'foot' },
  transit: { icon: BusFront, tone: 'foot' },
  bike_lts2: { icon: Bike, tone: 'bike' },
  bike_lts4: { icon: Bike, tone: 'bike' },
}

const loadedModes = ref(new Set<string>())
const unavailableModes = ref(new Set<string>())
const mapGallery = ref<InstanceType<typeof CahierMapGallery> | null>(null)
const unavailableInspectionLabel = ref<string | null>(null)

const comparisonGroups = computed(() => props.evidence.comparisonGroups.map((group) => ({
  ...group,
  maps: group.mapModes.flatMap((mode) => props.evidence.maps.filter((map) => map.mode === mode)),
})))

const mapGalleryImages = computed(() => props.evidence.maps.flatMap((map) => {
  if (!map.inspectionAvailable) return []
  const src = aedarDiversityLossMapAssetUrl(props.evidence.territory.code, map.mode, 'inspection')
  return src ? [{
    key: map.mode,
    src,
    alt: `Carte détaillée de la perte de diversité en ${map.label} par rapport à la voiture, à ${props.evidence.territory.name}, en ${props.evidence.horizonMinutes} minutes.`,
  }] : []
}))

function inlineMapUrl(map: AedarDiversityLossMapEvidence): string | null {
  if (!map.inlineAvailable) return null
  return aedarDiversityLossMapAssetUrl(props.evidence.territory.code, map.mode, 'inline')
}

function markLoaded(mode: string): void {
  loadedModes.value = new Set(loadedModes.value).add(mode)
}

function markUnavailable(mode: string): void {
  unavailableModes.value = new Set(unavailableModes.value).add(mode)
}

async function inspectMap(map: AedarDiversityLossMapEvidence): Promise<void> {
  unavailableInspectionLabel.value = await mapGallery.value?.open(map.mode)
    ? null
    : map.label
}

function markInspectionUnavailable(mode: string): void {
  unavailableInspectionLabel.value = props.evidence.maps.find((map) => map.mode === mode)?.label ?? mode
}

function mapStateLabel(map: AedarDiversityLossMapEvidence): string {
  return map.inlineAvailable ? 'Carte indisponible' : 'Carte de production indisponible'
}
</script>

<template>
  <figure class="aedar-diversity-loss" :style="CAHIER_MAP_LAYOUT_STYLE">
    <CahierProse class="argument-copy aedar-diversity-loss__introduction" :blocks="props.evidence.introduction" />
    <CahierEvidenceSource v-if="props.evidence.source" :source="props.evidence.source" />
    <figcaption class="cahier-figure-title cahier-baseline-anchor">
      <CahierProse :blocks="[props.evidence.mapFigureTitle]" />
    </figcaption>

    <div class="aedar-diversity-loss__layout">
      <div class="aedar-diversity-loss__comparisons">
        <section
          v-for="group in comparisonGroups"
          :key="group.key"
          class="aedar-diversity-loss__comparison-row"
          role="group"
          :aria-label="group.label"
        >
          <template v-for="map in group.maps" :key="map.mode">
            <section
              class="aedar-diversity-loss-map map-panel"
              :class="[`map-panel--${modePresentation[map.mode].tone}`, `aedar-diversity-loss-map--${map.mode}`]"
              :style="{ '--mode-ring': AEDAR_TIME_MODE_COLORS[map.mode] }"
              :aria-label="`${map.label} — ${props.evidence.territory.name} — ${props.evidence.horizonMinutes} minutes`"
            >
              <div class="aedar-diversity-loss-map-label map-panel-label" aria-hidden="true">
                <component :is="modePresentation[map.mode].icon" :size="16" :stroke-width="1.8" aria-hidden="true" />
                <span>{{ map.label }}</span>
              </div>
              <CahierMapPanel
                v-if="inlineMapUrl(map)"
                class="aedar-diversity-loss-map__panel"
                :image-url="inlineMapUrl(map)!"
                :image-alt="`Carte de la perte de diversité en ${map.label} par rapport à la voiture, à ${props.evidence.territory.name}, en ${props.evidence.horizonMinutes} minutes.`"
                :accessible-name="`Agrandir la carte ${map.label} pour ${props.evidence.territory.name}`"
                :number="String(props.evidence.maps.findIndex((candidate) => candidate.mode === map.mode) + 1).padStart(2, '0')"
                :loaded="loadedModes.has(map.mode)"
                :unavailable="unavailableModes.has(map.mode)"
                @loaded="markLoaded(map.mode)"
                @unavailable="markUnavailable(map.mode)"
                @inspect="inspectMap(map)"
              />
              <div
                v-else
                class="aedar-diversity-loss-map__panel aedar-diversity-loss-map__unavailable"
                role="img"
                :aria-label="`${mapStateLabel(map)} : ${map.label} pour ${props.evidence.territory.name}`"
              >
                <span class="aedar-diversity-loss-map__number" aria-hidden="true">{{ String(props.evidence.maps.findIndex((candidate) => candidate.mode === map.mode) + 1).padStart(2, '0') }}</span>
                <span>{{ mapStateLabel(map) }}</span>
                <span class="aedar-diversity-loss-map__territory">{{ props.evidence.territory.name }}</span>
              </div>
            </section>
          </template>
          <CahierProse class="argument-copy aedar-diversity-loss__comparison-copy" :blocks="group.prompt" />
        </section>
      </div>

      <div v-if="props.evidence.legend" class="aedar-diversity-loss__legend">
        <CahierContinuousMapLegend
          :title="props.evidence.legend.title"
          :colors="props.evidence.legend.colors"
          :tick-labels="props.evidence.legend.tickLabels"
          :note="props.evidence.legend.note"
          :aria-label="props.evidence.legend.ariaLabel"
        />
      </div>

      <p
        v-if="props.evidence.metadataNote"
        :role="props.evidence.metadataState === 'ready' ? undefined : 'status'"
        class="aedar-diversity-loss__status-note"
      >
        {{ props.evidence.metadataNote }}
      </p>
      <p v-if="unavailableInspectionLabel" role="status" class="aedar-diversity-loss__status-note">
        Carte détaillée indisponible pour {{ unavailableInspectionLabel }} — {{ props.evidence.territory.name }}.
      </p>
    </div>

    <CahierMapGallery
      ref="mapGallery"
      :images="mapGalleryImages"
      @unavailable="markInspectionUnavailable"
    />
  </figure>
</template>

<style scoped>
.aedar-diversity-loss { display: grid; gap: var(--space-4); width: 100%; margin: 0; container-type: inline-size; }
.aedar-diversity-loss__introduction { width: 100%; }
.aedar-diversity-loss > .cahier-figure-title { width: 72%; margin: 0; text-align: center; }
.aedar-diversity-loss__layout { --aedar-loss-columns: repeat(2, minmax(0, 1fr)) minmax(12rem, .8fr); display: grid; grid-template-columns: var(--aedar-loss-columns); gap: clamp(var(--space-5), 4vw, var(--space-8)) clamp(var(--space-3), 2vw, var(--space-6)); }
.aedar-diversity-loss__comparisons { display: grid; grid-column: 1 / -1; gap: clamp(var(--space-5), 4vw, var(--space-8)); }
.aedar-diversity-loss__comparison-row { display: grid; grid-template-columns: var(--aedar-loss-columns); gap: clamp(var(--space-3), 2vw, var(--space-6)); align-items: center; }
.aedar-diversity-loss-map { width: min(100%, 360px); justify-self: center; }
.aedar-diversity-loss-map-label { display: flex; min-height: 28px; justify-content: center; align-items: center; gap: 6px; margin: 0 0 6px; color: var(--mode-ring); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); text-transform: uppercase; }
.map-panel--foot { --mode-ring: var(--cahier-mode-foot); }
.map-panel--bike { --mode-ring: var(--cahier-mode-bike); }
.aedar-diversity-loss-map__unavailable { position: relative; display: grid; width: 100%; aspect-ratio: 1; place-content: center; justify-items: center; gap: 8px; overflow: hidden; border: var(--cahier-map-circle-border) solid var(--mode-ring); border-radius: 50%; background: color-mix(in srgb, var(--cahier-theme) 8%, var(--paper)); color: var(--muted); font: var(--text-caption); font-weight: 600; text-align: center; }
.aedar-diversity-loss-map__number { position: absolute; top: 9px; left: 11px; color: var(--mode-ring); font: var(--text-caption); font-variant-numeric: tabular-nums; }
.aedar-diversity-loss-map__territory { font: var(--text-caption); font-weight: 500; }
.aedar-diversity-loss__comparison-copy { max-width: 34ch; margin: 0; color: var(--muted); font: var(--text-body-sm); line-height: 1.55; text-align: justify; }
.aedar-diversity-loss__legend { grid-column: 1 / 3; width: min(100%, 520px); justify-self: center; }
.aedar-diversity-loss__status-note { grid-column: 1 / -1; margin: 0; color: var(--muted); font: var(--text-caption); text-align: center; }
@container (max-width: 760px) {
  .aedar-diversity-loss__layout { --aedar-loss-columns: repeat(2, minmax(0, 1fr)); }
  .aedar-diversity-loss > .cahier-figure-title { width: 100%; }
  .aedar-diversity-loss__legend { grid-column: 1 / -1; }
  .aedar-diversity-loss__comparison-copy { grid-column: 1 / -1; max-width: 72ch; }
}
@container (max-width: 560px) {
  .aedar-diversity-loss__layout { --aedar-loss-columns: minmax(0, 1fr); }
  .aedar-diversity-loss-map { width: min(100%, 420px); }
  .aedar-diversity-loss__legend { grid-column: 1; }
  .aedar-diversity-loss__comparison-copy { grid-column: auto; }
}
</style>
