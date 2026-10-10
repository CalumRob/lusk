<script setup lang="ts">
import { Bike, BusFront, CarFront } from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed } from 'vue'

import { CAHIER_MAP_LAYOUT_STYLE } from '@/fiche/cahierFigureGrammaire'
import type { TextBlock } from '@/fiche/content/themeContent'
import CahierFigureLecture from './CahierFigureLecture.vue'
import CahierProse from './CahierProse.vue'

const props = defineProps<{
  territory: { code: string; name: string }
  horizonMinutes: number
  /** Figure title owned by the semantic content layer (shared figure-title primitive). */
  title: TextBlock
  modeKeys?: readonly ('car' | 'bike-lts2' | 'transit')[]
  /** Reading under the map grid: honest empty state and provisional horizon. */
  lecture?: readonly TextBlock[]
}>()

const availableSlots: readonly { key: 'car' | 'bike-lts2' | 'transit'; label: string; icon: Component; tone: string }[] = [
  { key: 'car', label: 'Voiture', icon: CarFront, tone: 'car' },
  { key: 'bike-lts2', label: 'Vélo (LTS2)', icon: Bike, tone: 'bike' },
  { key: 'transit', label: 'Transports en commun', icon: BusFront, tone: 'foot' },
]
const slots = computed(() => availableSlots.filter((slot) => !props.modeKeys || props.modeKeys.includes(slot.key)))
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
        :aria-label="`${slot.label} — ${props.territory.name} — ${props.horizonMinutes} minutes — Carte à venir`"
      >
        <div class="map-panel-label" aria-hidden="true">
          <component :is="slot.icon" :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ slot.label }}</span>
        </div>
        <div class="blank-map-slot__viewport map-viewport" :style="{ '--mode-ring': `var(--cahier-mode-${slot.tone === 'foot' ? 'foot' : slot.tone})` }" role="img" :aria-label="`Zone vide, carte à venir : ${slot.label} pour ${props.territory.name}`">
          <span class="blank-map-slot__number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="blank-map-slot__state">Carte à venir</span>
          <span class="blank-map-slot__territory">{{ props.territory.name }}</span>
          <span class="blank-map-slot__horizon">{{ props.horizonMinutes }} minutes</span>
        </div>
      </section>
    </div>
    <CahierFigureLecture v-if="props.lecture && props.lecture.length > 0">
      <CahierProse :blocks="props.lecture" />
    </CahierFigureLecture>
  </figure>
</template>

<style src="./cahierLayout.css"></style>

<style scoped>
.blank-map-slots { margin: 0; padding: 0 0 var(--space-3); }
.blank-map-slots__grid { display: grid; grid-template-columns: var(--cahier-map-columns); gap: clamp(var(--space-4), 3vw, var(--space-8)); align-items: center; }
.blank-map-slot { width: min(100%, 360px); justify-self: center; }
.map-panel-label { display: flex; min-height: 28px; justify-content: center; align-items: center; gap: 6px; margin: 0 0 6px; color: var(--mode-ring); font: 700 10px/1.2 var(--font-sans); letter-spacing: .035em; text-transform: uppercase; }
.map-panel--car { --mode-ring: var(--cahier-mode-car); }
.map-panel--bike { --mode-ring: var(--cahier-mode-bike); }
.map-panel--foot { --mode-ring: var(--cahier-mode-foot); }
.blank-map-slot__viewport { position: relative; display: grid; width: 100%; aspect-ratio: 1; place-content: center; justify-items: center; gap: 8px; overflow: hidden; border: var(--cahier-map-circle-border) solid var(--mode-ring); border-radius: 50%; background: color-mix(in srgb, var(--cahier-theme) 8%, var(--paper)); color: var(--ink); text-align: center; }
.blank-map-slot__number { position: absolute; top: 9px; left: 11px; color: var(--mode-ring); font-size: 9px; font-variant-numeric: tabular-nums; }
.blank-map-slot__state { font: 700 clamp(11px, 1.5vw, 15px)/1.3 var(--font-sans); }
.blank-map-slot__territory, .blank-map-slot__horizon { color: var(--muted); font: 500 11px/1.3 var(--font-sans); }
@media (max-width: 760px) { .blank-map-slots__grid { grid-template-columns: 1fr; } .blank-map-slot { width: min(100%, 520px); } }
</style>
