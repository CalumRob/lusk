<script setup lang="ts">
/** PROTOTYPE — placeholder for a Figure d'atelier: title from the bindings, empty plot frame, cellule key, sources. */
import { computed } from 'vue'

import CahierFigureFrame from '@/fiche/prototype/CahierFigureFrame.vue'
import '@/fiche/prototype/cahierEvidenceSource.css'
import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'

import type { FigureSpec } from './AtelierFigureModal.vue'
import { CATEGORIES, APPARTENANCES, prettyExpression } from './prototypeFigure'

const props = defineProps<{ spec: FigureSpec; number: number }>()
defineEmits<{ remove: [] }>()

type Canal = Record<string, unknown> | null

function titleOf(canal: Canal): string {
  if (!canal) return ''
  if (typeof canal.cellule === 'string') return canal.cellule
  if (typeof canal.formule === 'string') return prettyExpression(canal.formule)
  if (typeof canal.categorie_territoriale === 'string') return CATEGORIES.find((c) => c.id === canal.categorie_territoriale)?.label ?? ''
  if (typeof canal.appartenance_territoriale === 'string') return APPARTENANCES.find((a) => a.id === canal.appartenance_territoriale)?.label ?? ''
  return ''
}

const canaux = computed(() => props.spec.canaux as Record<string, Canal>)
const title = computed(() => `y : ${titleOf(canaux.value.y!)} · x : ${titleOf(canaux.value.x!)}`)
const secondary = computed(() =>
  [canaux.value.taille ? `taille : ${titleOf(canaux.value.taille)}` : '', canaux.value.couleur ? `couleur : ${titleOf(canaux.value.couleur)}` : ''].filter(Boolean).join(' · '),
)
const levelLabel = computed(() => ({ commune: 'communes', epci: 'EPCI', departement: 'départements' })[props.spec.niveau] ?? props.spec.niveau)
const sources = computed(() => [...new Set(props.spec.cellules.map((c) => c.label))])

const g = CAHIER_FIGURE_GEOMETRY
const plot = { left: g.margin.left, right: g.width - g.margin.right, top: g.margin.top, bottom: g.height - g.margin.bottom }
const ticks = [0.25, 0.5, 0.75]
</script>

<template>
  <figure class="at-figure" :aria-label="`Figure ${number} — ${title}`">
    <div class="at-figure__head">
      <span class="at-figure__number">Fig. {{ String(number).padStart(2, '0') }}</span>
      <h2 class="at-figure__title">{{ title }}</h2>
      <button type="button" class="at-figure__remove" @click="$emit('remove')">Retirer la figure</button>
    </div>
    <p class="at-figure__channels">
      Nuage de {{ levelLabel }}<template v-if="secondary"> · {{ secondary }}</template
      ><template v-if="spec.filtre_population.length"> · population restreinte : {{ spec.filtre_population.map((p) => p.id).join(', ') }}</template>
    </p>

    <CahierFigureFrame :x-title="titleOf(canaux.x!)" :y-title="titleOf(canaux.y!)" size="standard">
      <template #plot>
        <svg class="cahier-figure-plot" :viewBox="`0 0 ${g.width} ${g.height}`" role="img" :aria-label="`Cadre vide du nuage ${title}`">
          <line v-for="t in ticks" :key="`h${t}`" class="cahier-figure-tick" :x1="plot.left" :x2="plot.right" :y1="plot.top + (plot.bottom - plot.top) * t" :y2="plot.top + (plot.bottom - plot.top) * t" />
          <line v-for="t in ticks" :key="`v${t}`" class="cahier-figure-tick" :y1="plot.top" :y2="plot.bottom" :x1="plot.left + (plot.right - plot.left) * t" :x2="plot.left + (plot.right - plot.left) * t" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.right" :y1="plot.bottom" :y2="plot.bottom" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.left" :y1="plot.top" :y2="plot.bottom" />
          <text class="at-figure__plot-note" :x="(plot.left + plot.right) / 2" :y="(plot.top + plot.bottom) / 2" text-anchor="middle">Figure non tracée — prototype</text>
        </svg>
      </template>
    </CahierFigureFrame>

    <dl class="at-figure__key">
      <template v-for="cell in spec.cellules" :key="cell.id">
        <dt>{{ cell.id }}</dt>
        <dd>{{ cell.lecture }}</dd>
        <dd>{{ cell.unite || 'sans unité' }}</dd>
      </template>
    </dl>
    <p class="cahier-evidence-source">Sources : {{ sources.join(' · ') }}</p>
  </figure>
</template>
