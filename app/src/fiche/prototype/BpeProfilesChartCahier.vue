<script setup lang="ts">
/**
 * The BPE access-profile figure. It is deliberately an SVG adapter, just like
 * the Distribution figure: one viewBox, one axis grammar, one label rhythm.
 * The figure's domain-specific marks are the grouped bars and the four
 * payload-owned profile details; no chart library owns the visual contract.
 */
import { computed, ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { MOBILITE_MODE_LABELS } from '@/fiche/content/territoryFacts'
import type {
  BpeAccessExemplar,
  BpeAccessProfileFact,
  NumericFact,
} from '@/fiche/content/territoryFacts'
import {
  type CahierFigureAxisTick,
  CAHIER_FIGURE_GEOMETRY,
  type CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import type { ProfilAccesBpe } from '@/payload/types'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierDonut from './CahierDonut.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureLegendMark from './CahierFigureLegendMark.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierReferenceNote from './CahierReferenceNote.vue'

const props = defineProps<{
  profiles: readonly BpeAccessProfileFact[]
  referenceLabel: string | null
  legend: readonly FigureLegendEntry[]
  explorationTo: RouteLocationRaw | null
}>()

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
const largeurBarre = 22
const ecartBarres = 7
const profilSelectionne = ref<number | null>(null)

const PROFILE_COLOR_TOKENS: Readonly<Record<ProfilAccesBpe, string>> = {
  'acces-pied-tc': '--cahier-mode-foot',
  'velo-compense': '--cahier-mode-bike',
  'voiture-requise': '--cahier-mode-car',
  'inaccessible-20-minutes': '--cahier-profile-inaccessible',
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function profileReference(profile: BpeAccessProfileFact): number | null {
  return profile.comparison?.reference?.value ?? null
}

function profileCountLabel(count: number): string {
  return `${formatNumber(count)} type${count === 1 ? '' : 's'}`
}

function profileColor(profile: ProfilAccesBpe): string {
  return `var(${PROFILE_COLOR_TOKENS[profile]})`
}

function profileFact(profile: BpeAccessProfileFact): NumericFact {
  return {
    key: `bpe-profile-${profile.profile}`,
    detail: null,
    label: profile.label,
    value: profile.count,
    unit: 'types',
    availability: 'complete',
    provenance: null,
    reason: null,
    comparison: profile.comparison
      ? {
          direction: profile.comparison.direction,
          scope: profile.comparison.scope,
          rank: profile.comparison.rank,
          reference: profile.comparison.reference,
        }
      : null,
  }
}

function formatPercentage(value: number): string {
  return `${formatNumber(value * 100)} %`
}

function donutStyle(values: BpeAccessExemplar): Record<string, string> {
  const walk = Math.max(0, Math.min(1, values.walkTransit))
  const bike = Math.max(walk, Math.min(1, values.bike))
  const car = Math.max(bike, Math.min(1, values.car))
  return {
    '--donut-walk': `${walk * 360}deg`,
    '--donut-bike': `${bike * 360}deg`,
    '--donut-car': `${car * 360}deg`,
  }
}

const maximum = computed(() =>
  Math.max(
    1,
    ...props.profiles.flatMap((profile) => [profile.count, profileReference(profile) ?? 0]),
  ),
)

const graduationsY = computed(() =>
  Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    const valeur = maximum.value * ratio
    return {
      valeur,
      y: yPour(valeur),
    }
  }),
)

const graduationsAxesX = computed<readonly CahierFigureAxisTick[]>(() =>
  props.profiles.map((_, index) => ({
    key: index,
    position: xPour(index),
    label: null,
  })),
)

const graduationsAxesY = computed<readonly CahierFigureAxisTick[]>(() =>
  graduationsY.value.map((graduation, index) => ({
    key: index,
    position: graduation.y,
    label: formatNumber(graduation.valeur, 0),
  })),
)

function xPour(index: number): number {
  const nombreProfils = Math.max(props.profiles.length, 1)
  return marge.gauche + ((index + 0.5) / nombreProfils) * (axeDroite - marge.gauche)
}

function yPour(value: number): number {
  return axeBas - (value / maximum.value) * (axeBas - marge.haut)
}

function hauteurBarre(value: number): number {
  return Math.max(0, axeBas - yPour(value))
}

function styleBarre(profile: ProfilAccesBpe): Record<string, string> {
  return { fill: profileColor(profile) }
}

function accessibleLabel(): string {
  const total = props.profiles.reduce((sum, profile) => sum + profile.count, 0)
  const reference = props.referenceLabel
    ? ` Référence : ${props.referenceLabel}.`
    : ' Référence indisponible.'
  const values = props.profiles
    .map((profile) => {
      const referenceValue = profileReference(profile)
      return `${profile.label} : ${formatNumber(profile.count)} types${
        referenceValue === null ? '' : `, ${props.referenceLabel ?? 'référence'} : ${formatNumber(referenceValue)} types`
      }`
    })
    .join('; ')
  return `Profils d’accès par mode. ${values}. Total du territoire : ${formatNumber(total)} types.${reference}`
}

function tooltipRows(profile: BpeAccessProfileFact): readonly CahierTooltipRow[] {
  const color = profileColor(profile.profile)
  const reference = profileReference(profile)
  return [
    {
      label: 'Territoire',
      value: profileCountLabel(profile.count),
      tone: 'neutral',
      markerColor: color,
    },
    ...(reference === null
      ? []
      : [
          {
            label: props.referenceLabel ?? 'Référence',
            value: profileCountLabel(reference),
            tone: 'neutral' as const,
            markerColor: `color-mix(in srgb, ${color} 30%, var(--paper))`,
          },
        ]),
  ]
}

function selectionnerProfil(index: number): void {
  profilSelectionne.value = index
}

function effacerProfil(index: number): void {
  if (profilSelectionne.value === index) profilSelectionne.value = null
}

const profilAvecInfobulle = computed(() =>
  profilSelectionne.value === null ? null : props.profiles[profilSelectionne.value] ?? null,
)
</script>

<template>
  <CahierFigureFrame
    class="bpe-profile-visual"
    x-title="Situation d’accès"
    y-title="Nombre de types d’équipement"
  >
    <template #plot>
      <div class="bpe-profile-chart cahier-figure-plot" role="group" :aria-label="accessibleLabel()">
        <svg
          class="bpe-profile-chart-svg"
          :viewBox="`0 0 ${largeur} ${hauteur}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          :aria-label="accessibleLabel()"
        >
          <CahierFigureAxes :x-ticks="graduationsAxesX" :y-ticks="graduationsAxesY" />

          <g v-for="(profile, index) in profiles" :key="profile.profile">
          <g
            class="bpe-profile-bars"
            :data-profile="profile.profile"
            role="img"
            tabindex="0"
            :aria-describedby="profilSelectionne === index ? `bpe-profile-tooltip-${profile.profile}` : undefined"
            :aria-label="`${profile.label}. Territoire : ${profileCountLabel(profile.count)}${profileReference(profile) === null ? '' : `. ${props.referenceLabel ?? 'Référence'} : ${profileCountLabel(profileReference(profile)!)}`}`"
            @mouseenter="selectionnerProfil(index)"
            @mouseleave="effacerProfil(index)"
            @focus="selectionnerProfil(index)"
            @blur="effacerProfil(index)"
          >
            <rect
              v-if="profile.count > 0"
              class="bpe-profile-bar bpe-profile-bar--territory"
              :x="xPour(index) - ecartBarres / 2 - largeurBarre"
              :y="yPour(profile.count)"
              :width="largeurBarre"
              :height="hauteurBarre(profile.count)"
              :style="styleBarre(profile.profile)"
              aria-hidden="true"
            />
            <rect
              v-if="profileReference(profile) !== null && profileReference(profile)! > 0"
              class="bpe-profile-bar bpe-profile-bar--reference"
              :x="xPour(index) + ecartBarres / 2"
              :y="yPour(profileReference(profile)!)"
              :width="largeurBarre"
              :height="hauteurBarre(profileReference(profile)!)"
              :style="styleBarre(profile.profile)"
              aria-hidden="true"
            />
          </g>
          </g>
        </svg>
      </div>
    </template>

    <CahierFigureTooltip
      v-if="profilAvecInfobulle"
      :id="`bpe-profile-tooltip-${profilAvecInfobulle.profile}`"
      class="bpe-profile-tooltip cahier-figure-tooltip--chart"
      title="Détail du profil"
      :rows="tooltipRows(profilAvecInfobulle)"
    />

    <CahierFigureLegend
      :entries="props.legend"
      label="Séries comparées"
      class="bpe-profile-series-key"
    />

    <div class="bpe-profile-details">
      <div
        v-for="profile in profiles"
        :key="profile.profile"
        class="bpe-profile-column"
        :data-profile="profile.profile"
        role="group"
        :aria-label="profile.label"
      >
        <strong class="bpe-profile-label">
          <CahierFigureLegendMark
            :entry="{ key: profile.profile, label: profile.label, marker: 'square' }"
            :mark-color="profileColor(profile.profile)"
            class="bpe-profile-swatch"
          />
          {{ profile.label }}
        </strong>
        <CahierFigureScalar
          class="bpe-profile-count"
          :style="{ '--cahier-figure-scalar-color': profileColor(profile.profile) }"
          :value="profileCountLabel(profile.count)"
          label=""
          :show-label="false"
          color-value
          :aria-label="`${profile.label} : ${profileCountLabel(profile.count)}`"
        >
          <template #reference>
            <CahierReferenceNote
              :fact="profileFact(profile)"
              :reference-label="referenceLabel ? 'vs ref*' : null"
              :to="explorationTo"
            />
          </template>
        </CahierFigureScalar>
        <template v-if="profile.exemplar">
          <CahierDonut
            class="stacked-donut bpe-profile-donut"
            :style="donutStyle(profile.exemplar)"
            :label-accessible="`${profile.exemplar.label}. ${MOBILITE_MODE_LABELS.walkTransit} : ${formatPercentage(profile.exemplar.walkTransit)}; ${MOBILITE_MODE_LABELS.bike} : ${formatPercentage(profile.exemplar.bike)}; ${MOBILITE_MODE_LABELS.car} : ${formatPercentage(profile.exemplar.car)}`"
          >
            <span>Exemple</span>
          </CahierDonut>
          <span class="bpe-profile-exemplar">{{ profile.exemplar.label }}</span>
        </template>
        <span v-else class="bpe-profile-exemplar bpe-profile-exemplar--empty">Exemple indisponible</span>
      </div>
    </div>
  </CahierFigureFrame>
</template>

<style>
/* The frame renders this component's slots; keep its namespaced mark styles
   global so they cross the frame's slot seam. Shared frame styles stay in
   cahierFigure.css. */
.bpe-profile-visual {
  --cahier-donut-size: clamp(56px, 7vw, 76px);
}

.bpe-profile-chart {
  height: auto;
}

.bpe-profile-chart-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.bpe-profile-bars {
  cursor: help;
  outline: none;
}

.bpe-profile-bar {
  stroke: transparent;
  stroke-width: 0;
}

.bpe-profile-bar--reference {
  opacity: 0.32;
}

.bpe-profile-bars:focus-visible .bpe-profile-bar--territory,
.bpe-profile-bars:hover .bpe-profile-bar--territory {
  stroke: var(--cahier-region-emphasis);
  stroke-width: 2;
}

.bpe-profile-details {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 8px var(--cahier-figure-grid-right) 0 var(--cahier-figure-grid-left);
}

.bpe-profile-column {
  display: grid;
  min-width: 0;
  gap: 8px;
  justify-items: center;
  text-align: center;
}

.bpe-profile-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--cahier-default);
  font: var(--type-figure-column);
  letter-spacing: var(--type-figure-column-tracking);
  line-height: 1.2;
}

.bpe-profile-count {
  margin-top: -1px;
}

.bpe-profile-swatch {
  width: 8px;
  height: 8px;
}

.bpe-profile-donut {
  margin-top: var(--space-1);
}

.bpe-profile-exemplar {
  max-width: 16ch;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.bpe-profile-exemplar--empty {
  color: var(--cahier-default);
  font-style: italic;
}

@container cahier-page (max-width: 620px) {
  .bpe-profile-details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6) var(--space-3);
  }
}
</style>
