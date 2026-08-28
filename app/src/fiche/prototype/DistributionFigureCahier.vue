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

import type { DistributionMobilite } from '@/fiche/sousGroupes'
import type { PointNuageMobilite } from '@/payload/selectors'
import { formaterNombreFR } from '@/payload/selectors'

const props = defineProps<{
  distribution: DistributionMobilite
  mediane: number
  medianeVelo: number
  modes: { t: string; b: string }
  nom: string
  nuage: PointNuageMobilite[]
}>()

const router = useRouter()
const distributionRef = ref<HTMLElement | null>(null)
const pointSelectionne = ref<PointNuageMobilite | null>(null)
const positionInfobulle = ref({ top: 0, left: 0 })

const largeur = 820
const hauteur = 340
const marge = { haut: 38, droite: 26, bas: 58, gauche: 88 }
const axeBas = hauteur - marge.bas
const axeDroite = largeur - marge.droite

const valeursX = computed(() => {
  const valeurs = props.distribution.dec.filter((valeur): valeur is number => valeur !== null)
  valeurs.push(...props.nuage.map((point) => point.divLoss))
  if (props.distribution.min !== null) valeurs.push(props.distribution.min)
  if (props.distribution.max !== null) valeurs.push(props.distribution.max)
  valeurs.push(props.mediane, props.medianeVelo)
  return valeurs
})

const domaineX = computed(() => {
  const min = Math.min(...valeursX.value, 0)
  const max = Math.max(...valeursX.value, 1)
  return max - min < 1 ? { min: min - 0.5, max: max + 0.5 } : { min, max }
})

const densiteMax = computed(() => {
  const valeurs = props.distribution.dens.filter((valeur): valeur is number => valeur !== null)
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
  props.distribution.dec
    .map((dec, index) => {
      const densite = props.distribution.dens[index]
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
  props.nuage.map((point, index) => ({
    ...point,
    x: xPour(point.divLoss),
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

const repereT = computed(() => xPour(props.mediane))
const repereB = computed(() => xPour(props.medianeVelo))

const positionRepereT = computed(() => ({ left: `${(repereT.value / largeur) * 100}%` }))
const positionRepereB = computed(() => ({ left: `${(repereB.value / largeur) * 100}%` }))

const libelleAccessible = computed(
  () =>
    `${props.nom}. Distribution des bâtiments selon le nombre de types de services perdus. ` +
    `Médiane ${props.modes.t} : ${formaterNombreFR(props.mediane, 0)}. ` +
    `Médiane ${props.modes.b} : ${formaterNombreFR(props.medianeVelo, 0)}.`,
)

function lienNuage(point: PointNuageMobilite): string {
  return router.resolve({
    name: 'territoire',
    params: { type: point.type, id: point.territoire },
    query: { theme: 'mobilite' },
  }).href
}

function selectionnerNuage(point: PointNuageMobilite, event: MouseEvent | KeyboardEvent): void {
  const cible = event.currentTarget
  const figure = distributionRef.value
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
</script>

<template>
    <div ref="distributionRef" class="distribution-cahier">
    <div class="distribution-plot">
      <svg
        class="distribution-cahier-svg"
        :viewBox="`0 0 ${largeur} ${hauteur}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="libelleAccessible"
      >
      <line class="distribution-axis" :x1="marge.gauche" :x2="axeDroite" :y1="axeBas" :y2="axeBas" />
      <line class="distribution-axis" :x1="marge.gauche" :x2="marge.gauche" :y1="marge.haut" :y2="axeBas" />

      <path v-if="aireDistribution" class="distribution-area" :d="aireDistribution" />
      <path v-if="ligneDistribution" class="distribution-line" :d="ligneDistribution" />

      <line class="distribution-reference distribution-reference--territory" :x1="repereT" :x2="repereT" :y1="marge.haut" :y2="axeBas" />
      <line class="distribution-reference distribution-reference--bike" :x1="repereB" :x2="repereB" :y1="marge.haut" :y2="axeBas" />
      <g v-for="point in nuagePoints" :key="point.territoire" class="distribution-peer">
        <circle
          :cx="point.x"
          :cy="point.y"
          r="5"
          tabindex="0"
          role="button"
          :aria-label="`${point.nom} : ${formaterNombreFR(point.divLoss, 0)} types de services perdus`"
          @click="selectionnerNuage(point, $event)"
          @keydown.enter.prevent="selectionnerNuage(point, $event)"
        />
      </g>

      <g v-for="graduation in graduations" :key="graduation.valeur">
        <line class="distribution-tick" :x1="graduation.x" :x2="graduation.x" :y1="axeBas" :y2="axeBas + 7" />
        <text class="distribution-tick-label" :x="graduation.x" :y="axeBas + 22" text-anchor="middle">
          {{ formaterNombreFR(graduation.valeur, 0) }}
        </text>
      </g>
      <g v-for="graduation in graduationsY" :key="graduation.valeur">
        <line class="distribution-tick" :x1="marge.gauche - 7" :x2="marge.gauche" :y1="graduation.y" :y2="graduation.y" />
        <text class="distribution-y-tick-label" :x="marge.gauche - 12" :y="graduation.y + 4" text-anchor="end">
          {{ formaterNombreFR(graduation.valeur, 2) }}
        </text>
      </g>
      </svg>
      <span class="distribution-axis-title distribution-axis-title--x type-figure-column">Types de services perdus</span>
      <span class="distribution-axis-title distribution-axis-title--y type-figure-column">Densité des bâtiments</span>
    </div>
    <div class="distribution-reference-icons" aria-hidden="true">
      <span
        class="distribution-reference-icon distribution-reference-icon--territory"
        :style="positionRepereT"
        :title="`${modes.t} : ${formaterNombreFR(mediane, 0)}`"
      >
        <Footprints :size="16" stroke-width="1.7" />
      </span>
      <span
        class="distribution-reference-icon distribution-reference-icon--bike"
        :style="positionRepereB"
        :title="`${modes.b} : ${formaterNombreFR(medianeVelo, 0)}`"
      >
        <Bike :size="16" stroke-width="1.7" />
      </span>
    </div>
    <aside v-if="pointSelectionne" class="distribution-callout" :style="styleInfobulle" aria-live="polite">
      <div>
        <strong>{{ pointSelectionne.nom }}</strong>
        <span>{{ formaterNombreFR(pointSelectionne.divLoss, 0) }} types de services perdus</span>
      </div>
      <a
        v-if="pointSelectionne.type !== 'region'"
        :href="lienNuage(pointSelectionne)"
        target="_blank"
        rel="noreferrer"
      >
        Ouvrir la fiche
      </a>
      <button type="button" aria-label="Fermer le détail" @click="fermerSelection">Fermer</button>
    </aside>
    <div class="distribution-legend" aria-hidden="true">
      <span><i class="distribution-key distribution-key--curve" />Distribution du territoire</span>
      <span><i class="distribution-key distribution-key--peer" />Territoires comparables</span>
      <span><i class="distribution-key distribution-key--reference" />Médianes</span>
    </div>
  </div>
</template>

<style scoped>
.distribution-cahier {
  position: relative;
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

.distribution-axis,
.distribution-tick {
  fill: none;
  stroke: color-mix(in srgb, var(--cahier-default) 22%, transparent);
  stroke-width: 1;
}

.distribution-axis {
  stroke: color-mix(in srgb, var(--cahier-default) 58%, transparent);
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

.distribution-tick-label,
.distribution-y-tick-label {
  fill: var(--cahier-default);
  font: var(--type-figure-column);
}

.distribution-axis-title {
  position: absolute;
  z-index: 1;
  fill: var(--cahier-default);
  color: var(--cahier-default);
  white-space: nowrap;
  text-align: center;
  pointer-events: none;
}

.distribution-axis-title--x {
  bottom: 0;
  left: 53.8%;
  transform: translateX(-50%);
}

.distribution-axis-title--y {
  top: 47.1%;
  left: 2.7%;
  transform: translate(-50%, -50%) rotate(-90deg);
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

.distribution-callout {
  position: absolute;
  z-index: 20;
  width: min(330px, calc(100% - 24px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  box-shadow: 0 12px 30px rgba(35, 42, 42, 0.2);
  border: 1px solid color-mix(in srgb, var(--cahier-mode-foot) 30%, transparent);
  background: color-mix(in srgb, var(--cahier-mode-foot) 8%, var(--paper));
  color: var(--ink);
  font-size: 12px;
}

.distribution-callout div {
  display: grid;
  gap: 3px;
}

.distribution-callout span {
  color: var(--cahier-mode-foot);
}

.distribution-callout a {
  color: var(--cahier-region-emphasis);
  font-weight: 700;
  text-underline-offset: 3px;
  white-space: nowrap;
}

.distribution-callout button {
  border: 0;
  background: transparent;
  color: var(--cahier-region-emphasis);
  cursor: pointer;
  font: inherit;
  padding: 0;
  white-space: nowrap;
}

.distribution-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 8px;
  justify-content: center;
  color: var(--cahier-default);
  font: var(--type-figure-legend);
}

.distribution-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.distribution-key {
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 2px;
  background: var(--cahier-mode-foot);
}

.distribution-key--peer {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cahier-default);
}

.distribution-key--reference {
  height: 0;
  border-top: 2px dashed var(--cahier-region-emphasis);
  background: transparent;
}
</style>
