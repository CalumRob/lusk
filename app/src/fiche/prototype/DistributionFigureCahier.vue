<script setup lang="ts">
/**
 * [PROTOTYPE #511 — JETABLE] A distribution figure made for the Cahier.
 *
 * This deliberately does not reuse the fiche's canvas chart. The SVG keeps the
 * density profile legible when the page is zoomed, while the shared viewBox
 * means labels and comparison marks scale with the figure instead of escaping
 * its container.
 */
import { computed, ref } from 'vue'
import { Bike, Footprints } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import type { DistributionEvidence } from '@/fiche/content/themeContent'
import {
  type CahierFigureAxisTick,
  CAHIER_FIGURE_GEOMETRY,
  type CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import {
  MOBILITE_MODE_LABELS,
} from '@/fiche/content/territoryFacts'
import type { MobiliteDistributionPeer } from '@/fiche/content/territoryFacts'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'

const props = defineProps<{
  evidence: DistributionEvidence
  nom: string
}>()

const router = useRouter()
const distributionRef = ref<{ rootElement: HTMLElement | null } | null>(null)
const pointSelectionne = ref<MobiliteDistributionPeer | null>(null)
const positionInfobulle = ref({ top: 0, left: 0 })

const largeur = CAHIER_FIGURE_GEOMETRY.width
const hauteur = CAHIER_FIGURE_GEOMETRY.height
const marge = {
  haut: CAHIER_FIGURE_GEOMETRY.margin.top,
  droite: CAHIER_FIGURE_GEOMETRY.margin.right,
  bas: CAHIER_FIGURE_GEOMETRY.margin.bottom,
  gauche: CAHIER_FIGURE_GEOMETRY.margin.left,
}
const axeBas = hauteur - marge.bas
const axeDroite = largeur - marge.droite

const walkTransit = computed(() => props.evidence.marks.walkTransit)
const bike = computed(() => props.evidence.marks.bike)
const mediane = computed(() => walkTransit.value.fact.value ?? 0)
const medianeVelo = computed(() => bike.value?.fact.value ?? null)

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

const valeursX = computed(() => {
  const valeurs = [...props.evidence.distribution.quantiles]
  valeurs.push(...props.evidence.peers.map((point) => point.value))
  valeurs.push(props.evidence.distribution.min, props.evidence.distribution.max, mediane.value)
  if (medianeVelo.value !== null) valeurs.push(medianeVelo.value)
  return valeurs
})

const domaineX = computed(() => {
  const min = Math.min(...valeursX.value, 0)
  const max = Math.max(...valeursX.value, 1)
  return max - min < 1 ? { min: min - 0.5, max: max + 0.5 } : { min, max }
})

const densiteMax = computed(() => {
  const valeurs = props.evidence.distribution.densities
  return Math.max(...valeurs, 0.001)
})

function xPour(valeur: number): number {
  const { min, max } = domaineX.value
  return marge.gauche + ((valeur - min) / (max - min)) * (axeDroite - marge.gauche)
}

function yPour(valeur: number): number {
  return axeBas - (valeur / densiteMax.value) * (axeBas - marge.haut)
}

const points = computed(() =>
  props.evidence.distribution.quantiles
    .map((dec, index) => {
      const densite = props.evidence.distribution.densities[index]
      return dec !== null && densite !== null ? { x: xPour(dec), y: yPour(densite) } : null
    })
    .filter((point): point is { x: number; y: number } => point !== null),
)

const ligneDistribution = computed(() =>
  points.value.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '),
)

const aireDistribution = computed(() => {
  const first = points.value[0]
  const last = points.value.at(-1)
  if (!first || !last) return ''
  return `M ${first.x.toFixed(2)} ${axeBas} L ${points.value
    .map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' L ')} L ${last.x.toFixed(2)} ${axeBas} Z`
})

const nuagePoints = computed(() =>
  props.evidence.peers.map((point, index) => ({
    territoire: point.territoire,
    nom: point.territoire.name,
    value: point.value,
    x: xPour(point.value),
    y: axeBas - 10 - (index % 4) * 10,
  })),
)

const graduations = computed(() => {
  const { min, max } = domaineX.value
  return Array.from({ length: 5 }, (_, index) => {
    const valeur = min + ((max - min) * index) / 4
    return { valeur, x: xPour(valeur) }
  })
})

const graduationsY = computed(() =>
  Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    const valeur = densiteMax.value * ratio
    return { valeur, y: yPour(valeur) }
  }),
)

const repereT = computed(() => xPour(mediane.value))
const repereB = computed(() => xPour(medianeVelo.value ?? mediane.value))

const positionRepereT = computed(() => ({ left: `${(repereT.value / largeur) * 100}%` }))
const positionRepereB = computed(() => ({ left: `${(repereB.value / largeur) * 100}%` }))

const libelleAccessible = computed(
  () =>
    `${props.nom}. Distribution des bâtiments selon le nombre de types de services perdus. ` +
    `Médiane ${MOBILITE_MODE_LABELS.walkTransit} : ${formatNumber(mediane.value, 0)}.` +
    (bike.value && medianeVelo.value !== null
      ? ` Médiane ${MOBILITE_MODE_LABELS.bike} : ${formatNumber(medianeVelo.value, 0)}.`
      : ''),
)

const graduationsAxesX = computed<readonly CahierFigureAxisTick[]>(() =>
  graduations.value.map((graduation, index) => ({
    key: index,
    position: graduation.x,
    label: formatNumber(graduation.valeur, 0),
  })),
)

const graduationsAxesY = computed<readonly CahierFigureAxisTick[]>(() =>
  graduationsY.value.map((graduation, index) => ({
    key: index,
    position: graduation.y,
    label: formatNumber(graduation.valeur, 2),
  })),
)

function lienNuage(point: MobiliteDistributionPeer): string {
  return router.resolve({
    name: 'territoire',
    params: { type: point.territoire.type, id: point.territoire.code },
    query: { theme: 'mobilite' },
  }).href
}

function selectionnerNuage(point: MobiliteDistributionPeer, event: MouseEvent | KeyboardEvent): void {
  const cible = event.currentTarget
  const figure = distributionRef.value?.rootElement ?? null
  if (cible instanceof SVGCircleElement && figure) {
    const rectangle = cible.getBoundingClientRect()
    const figureRectangle = figure.getBoundingClientRect()
    const largeurInfobulle = Math.min(330, Math.max(0, figure.clientWidth - 24))
    const left = Math.min(
      Math.max(12, rectangle.left - figureRectangle.left + rectangle.width / 2 + 16),
      Math.max(12, figure.clientWidth - largeurInfobulle - 12),
    )
    const top =
      rectangle.bottom - figureRectangle.top + 150 < figure.clientHeight
        ? rectangle.bottom - figureRectangle.top + 12
        : Math.max(12, rectangle.top - figureRectangle.top - 150)
    positionInfobulle.value = { top, left }
  }
  pointSelectionne.value = point
}

function fermerSelection(): void {
  pointSelectionne.value = null
}

const styleInfobulle = computed(() => ({
  top: `${positionInfobulle.value.top}px`,
  left: `${positionInfobulle.value.left}px`,
}))

function pointTooltipRows(point: MobiliteDistributionPeer): readonly CahierTooltipRow[] {
  return [
    {
      label: 'Types de services perdus',
      value: formatNumber(point.value, 0),
      tone: 'neutral',
    },
  ]
}
</script>

<template>
  <CahierFigureFrame
    ref="distributionRef"
    class="distribution-cahier"
    x-title="Types de services perdus"
    y-title="Densité des bâtiments"
  >
    <template #plot>
      <div class="distribution-plot cahier-figure-plot">
      <svg
        class="distribution-cahier-svg"
        :viewBox="`0 0 ${largeur} ${hauteur}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="libelleAccessible"
      >
        <CahierFigureAxes :x-ticks="graduationsAxesX" :y-ticks="graduationsAxesY" />

      <path v-if="aireDistribution" class="distribution-area" :d="aireDistribution" />
      <path v-if="ligneDistribution" class="distribution-line" :d="ligneDistribution" />

      <line class="distribution-reference distribution-reference--territory" :x1="repereT" :x2="repereT" :y1="marge.haut" :y2="axeBas" />
      <line v-if="medianeVelo !== null" class="distribution-reference distribution-reference--bike" :x1="repereB" :x2="repereB" :y1="marge.haut" :y2="axeBas" />
      <g v-for="point in nuagePoints" :key="point.territoire.code" class="distribution-peer">
        <circle
          :cx="point.x"
          :cy="point.y"
          r="5"
          tabindex="0"
          role="button"
          :aria-label="`${point.nom} : ${formatNumber(point.value, 0)} types de services perdus`"
          @click="selectionnerNuage(point, $event)"
          @keydown.enter.prevent="selectionnerNuage(point, $event)"
        />
      </g>

      </svg>
      </div>
    </template>
    <div class="distribution-reference-icons" aria-hidden="true">
      <span
        class="distribution-reference-icon distribution-reference-icon--territory"
        :style="positionRepereT"
        :title="`${MOBILITE_MODE_LABELS.walkTransit} : ${formatNumber(mediane, 0)}`"
      >
        <Footprints :size="16" stroke-width="1.7" />
      </span>
      <span
        v-if="bike && medianeVelo !== null"
        class="distribution-reference-icon distribution-reference-icon--bike"
        :style="positionRepereB"
        :title="`${MOBILITE_MODE_LABELS.bike} : ${formatNumber(medianeVelo, 0)}`"
      >
        <Bike :size="16" stroke-width="1.7" />
      </span>
    </div>
    <CahierFigureTooltip
      v-if="pointSelectionne"
      class="distribution-callout cahier-figure-tooltip--anchored"
      :style="styleInfobulle"
      :title="pointSelectionne.territoire.name"
      :rows="pointTooltipRows(pointSelectionne)"
      aria-live="polite"
    >
      <template #actions>
        <a
          v-if="pointSelectionne.territoire.type !== 'region'"
          :href="lienNuage(pointSelectionne)"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ouvrir la fiche
        </a>
        <button type="button" aria-label="Fermer le détail" @click="fermerSelection">Fermer</button>
      </template>
    </CahierFigureTooltip>
    <CahierFigureLegend
      :entries="evidence.legend"
      label="Séries comparées"
      class="distribution-legend"
    />
  </CahierFigureFrame>
</template>

<style>
/* The frame renders this component's slots; keep its namespaced mark styles
   global so they cross the frame's slot seam. Shared frame styles stay in
   cahierFigure.css. */
.distribution-cahier {
  width: 100%;
  min-width: 0;
}

.distribution-plot {
  position: relative;
  width: 100%;
}

.distribution-cahier-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.distribution-area {
  fill: color-mix(in srgb, var(--cahier-mode-foot) 16%, transparent);
}

.distribution-line {
  fill: none;
  stroke: var(--cahier-mode-foot);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}

.distribution-reference {
  stroke-width: 2;
  stroke-dasharray: 5 5;
}

.distribution-reference--territory {
  stroke: var(--cahier-mode-foot);
}

.distribution-reference--bike {
  stroke: var(--cahier-mode-bike);
}

.distribution-reference-icons {
  position: absolute;
  top: 4px;
  left: 0;
  width: 100%;
  height: 24px;
  pointer-events: none;
}

.distribution-reference-icon {
  position: absolute;
  display: grid;
  place-items: center;
  transform: translateX(-50%);
}

.distribution-reference-icon--territory {
  top: 0;
  color: var(--cahier-mode-foot);
}

.distribution-reference-icon--bike {
  top: 0;
  color: var(--cahier-mode-bike);
}

.distribution-peer circle {
  fill: var(--cahier-default);
  cursor: pointer;
  opacity: 0.7;
  stroke: var(--paper);
  stroke-width: 2;
}

.distribution-peer circle:hover,
.distribution-peer circle:focus-visible {
  fill: var(--cahier-mode-foot);
  opacity: 1;
  outline: none;
  stroke: var(--cahier-mode-foot);
}

</style>
