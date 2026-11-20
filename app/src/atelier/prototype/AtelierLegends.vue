<script setup lang="ts">
/** PROTOTYPE — legends under a figure: categorical (CahierFigureLegend), continuous (CahierContinuousMapLegend), size (own, graduated circles). */
import { computed } from 'vue'

import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import CahierContinuousMapLegend from '@/fiche/prototype/CahierContinuousMapLegend.vue'
import CahierFigureLegend from '@/fiche/prototype/CahierFigureLegend.vue'

import type { ResourceDef } from './prototypeCellules'
import { axisDefault, type FigureState } from './prototypeFigure'
import type { Territoires } from './prototypeTerritoires'

const props = defineProps<{ state: FigureState; catalogue: ResourceDef[]; territoires: Territoires | null }>()

/** Categorical palette: existing colour roles only (theme anchors, mode inks, brand). */
const PALETTE = [
  'var(--theme-mobilite)',
  'var(--theme-habitat)',
  'var(--theme-demographie)',
  'var(--theme-economie)',
  'var(--theme-programmes)',
  'var(--theme-milieux)',
  'var(--cahier-mode-car)',
  'var(--cahier-mode-bike)',
  'var(--brand-500)',
  'var(--cahier-cycle-shared)',
]
const RAMP = [12, 28, 46, 64, 82, 100].map((n) => `color-mix(in srgb, var(--cahier-mode-bike) ${n}%, var(--paper))`)
const CAP = 12

const lookup = (id: string) => props.catalogue.find((r) => r.id === id)
const couleur = computed(() => props.state.channels.couleur)
const taille = computed(() => props.state.channels.taille)
const couleurTitle = computed(() => axisDefault(couleur.value, lookup))
const tailleTitle = computed(() => axisDefault(taille.value, lookup))

const categories = computed(() => {
  const c = couleur.value
  if (!props.territoires || (c.mode !== 'categorie' && c.mode !== 'appartenance')) return null
  const key = (c.mode === 'categorie' ? c.categorie : c.appartenance) as 'departement' | 'epci' | 'classe_densite' | 'littoral'
  const all = props.territoires.options[key]
  const picked = props.state.population[key]
  const list = picked.length ? all.filter((o) => picked.includes(o.value)) : all
  return { title: couleurTitle.value, list }
})

const legend = computed(() => {
  if (!categories.value) return null
  const shown = categories.value.list.slice(0, CAP)
  const entries: FigureLegendEntry[] = shown.map((o) => ({ key: o.value, label: o.label, marker: 'dot', tone: 'neutral' }))
  const colors: Record<string, string> = Object.fromEntries(shown.map((o, i) => [o.value, PALETTE[i % PALETTE.length]!]))
  const rest = categories.value.list.length - shown.length
  if (rest > 0) entries.push({ key: '__rest', label: `+ ${rest} autres`, marker: 'dash', tone: 'neutral' })
  return { entries, colors }
})
</script>

<template>
  <div v-if="legend || couleur.mode === 'cellule' || couleur.mode === 'formule' || taille.mode === 'cellule' || taille.mode === 'formule'" class="at-legends">
    <div v-if="legend" class="at-legend">
      <p class="at-legend__title">{{ categories!.title }}</p>
      <CahierFigureLegend :entries="legend.entries" :mark-colors="legend.colors" :label="`Légende de la couleur : ${categories!.title}`" />
    </div>

    <div v-else-if="couleur.mode === 'cellule' || couleur.mode === 'formule'" class="at-legend at-legend--ramp">
      <CahierContinuousMapLegend :title="couleurTitle" :colors="RAMP" :tick-labels="['min', 'max']" note="" :aria-label="`Légende de la couleur : ${couleurTitle}, du minimum au maximum`" />
    </div>

    <div v-if="taille.mode === 'cellule' || taille.mode === 'formule'" class="at-legend at-legend--size">
      <p class="at-legend__title">{{ tailleTitle }}</p>
      <svg class="at-size" viewBox="0 0 120 30" role="img" :aria-label="`Légende de la taille : ${tailleTitle}, du minimum au maximum`">
        <circle cx="12" cy="15" r="3" />
        <circle cx="42" cy="15" r="6" />
        <circle cx="86" cy="15" r="11" />
      </svg>
      <p class="at-size__ticks" aria-hidden="true"><span>min</span><span>max</span></p>
    </div>
  </div>
</template>

<style scoped>
.at-legends { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; gap: var(--space-3) var(--space-8); margin: var(--space-3) 0 0; }
.at-legend { display: grid; justify-items: center; gap: 2px; min-width: 0; max-width: 100%; }
.at-legend :deep(.cahier-figure-legend) { margin: 0; }
.at-legend__title { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); letter-spacing: var(--type-figure-label-tracking); text-align: center; overflow-wrap: anywhere; }
.at-legend--ramp { width: min(100%, 15rem); }
.at-legend--ramp :deep(.cahier-map-legend__title) { text-transform: none; overflow-wrap: anywhere; }
.at-legend--ramp :deep(.cahier-map-legend__note) { display: none; }
.at-legend--size { width: max-content; max-width: 100%; }
.at-size { width: 120px; height: 30px; fill: color-mix(in srgb, var(--cahier-default) 18%, transparent); stroke: var(--cahier-default); stroke-width: 1; }
.at-size__ticks { display: flex; justify-content: space-between; width: 120px; margin: 0; color: var(--cahier-default); font: var(--text-caption); }
</style>
