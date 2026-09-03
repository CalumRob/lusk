<script setup lang="ts">
/**
 * The BPE access-profile figure. It is deliberately an SVG adapter, just like
 * the Distribution figure: one viewBox, one axis grammar, one label rhythm.
 * The figure's domain-specific marks are the grouped bars and the four
 * payload-owned profile details; no chart library owns the visual contract.
 */
import { Bike, CarFront, CircleSlash2, Footprints } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import {
  MOBILITE_INACCESSIBLE_LABEL,
  MOBILITE_MODE_LABELS,
} from '@/fiche/content/territoryFacts'
import type {
  BpeAccessExemplar,
  BpeAccessProfileFact,
  NumericFact,
} from '@/fiche/content/territoryFacts'
import {
  type CahierFigureAxisTick,
  type CahierFigureTooltipAnchor,
  CAHIER_FIGURE_GEOMETRY,
  normaliserPartsDonut,
  type CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import type { ProfilAccesBpe } from '@/payload/types'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierDonut from './CahierDonut.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegendMark from './CahierFigureLegendMark.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import CahierComparisonValue from './CahierComparisonValue.vue'

const props = defineProps<{
  profiles: readonly BpeAccessProfileFact[]
  territoryName: string
  donutTooltipTitle: string
  comparisonLabel: string | null
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

const PROFILE_ICONS: Readonly<Record<ProfilAccesBpe, Component>> = {
  'acces-pied-tc': Footprints,
  'velo-compense': Bike,
  'voiture-requise': CarFront,
  'inaccessible-20-minutes': CircleSlash2,
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

function profileIcon(profile: ProfilAccesBpe): Component {
  return PROFILE_ICONS[profile]
}

function profileDisplayLabel(profile: BpeAccessProfileFact): string {
  return profile.profile === 'inaccessible-20-minutes'
    ? 'Inaccessible ou presque'
    : profile.label
}

function profileTone(profile: ProfilAccesBpe): CahierTooltipRow['tone'] {
  if (profile === 'acces-pied-tc') return 't'
  if (profile === 'velo-compense') return 'b'
  if (profile === 'voiture-requise') return 'c'
  return 'neutral'
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
  const { walkTransit: walk, bike, car } = normaliserPartsDonut(values)
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
  const reference = props.comparisonLabel
    ? ` Groupe comparé : ${props.comparisonLabel}.`
    : ' Groupe comparé indisponible.'
  const values = props.profiles
    .map((profile) => {
      const referenceValue = profileReference(profile)
      return `${profile.label} : ${formatNumber(profile.count)} types${
        referenceValue === null ? '' : `, ${props.comparisonLabel ?? 'Groupe comparé'} : ${formatNumber(referenceValue)} types`
      }`
    })
    .join('; ')
  return `Profils d’accès par mode. ${values}. Total ${props.territoryName} : ${formatNumber(total)} types.${reference}`
}

function tooltipRows(profile: BpeAccessProfileFact): readonly CahierTooltipRow[] {
  const reference = profileReference(profile)
  return [
    {
      label: props.territoryName,
      value: profileCountLabel(profile.count),
      tone: profileTone(profile.profile),
      icon: profileIcon(profile.profile),
    },
    ...(reference === null
      ? []
      : [
          {
            label: 'Groupe comparé',
            value: profileCountLabel(reference),
            tone: profileTone(profile.profile),
            icon: profileIcon(profile.profile),
          },
        ]),
  ]
}

function donutTooltipRows(profile: BpeAccessProfileFact): readonly CahierTooltipRow[] {
  if (!profile.exemplar) return []
  const values = normaliserPartsDonut(profile.exemplar)
  return [
    {
      label: MOBILITE_MODE_LABELS.walkTransit,
      value: formatPercentage(values.walkTransit),
      tone: 't',
      icon: Footprints,
    },
    {
      label: MOBILITE_MODE_LABELS.bike,
      value: formatPercentage(values.bike),
      tone: 'b',
      icon: Bike,
    },
    {
      label: MOBILITE_MODE_LABELS.car,
      value: formatPercentage(values.car),
      tone: 'c',
      icon: CarFront,
    },
    {
      label: MOBILITE_INACCESSIBLE_LABEL,
      value: formatPercentage(1 - values.car),
      tone: 'neutral',
      icon: CircleSlash2,
    },
  ]
}

function donutAccessibleLabel(profile: BpeAccessProfileFact): string {
  if (!profile.exemplar) return profile.label
  return `${profile.exemplar.label}. ${donutTooltipRows(profile)
    .map((row) => `${row.label} : ${row.value}`)
    .join('; ')}`
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

const profilInfobulleAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (profilSelectionne.value === null || !props.profiles[profilSelectionne.value]) return undefined
  return { x: `${(xPour(profilSelectionne.value) / largeur) * 100}%` }
})
</script>

<template>
  <CahierFigureFrame
    class="bpe-profile-visual"
    y-title="Types d’équipements"
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
             :aria-label="`${profile.label}. ${props.territoryName} : ${profileCountLabel(profile.count)}${profileReference(profile) === null ? '' : `. ${props.comparisonLabel ?? 'Groupe comparé'} : ${profileCountLabel(profileReference(profile)!)}`}`"
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
      :anchor="profilInfobulleAnchor"
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
          <span>{{ profileDisplayLabel(profile) }}</span>
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
            <CahierComparisonValue
              :fact="profileFact(profile)"
              :comparison-label="comparisonLabel ? 'Groupe comparé' : null"
              :to="explorationTo"
            />
          </template>
        </CahierFigureScalar>
        <div class="bpe-profile-donut-anchor">
          <template v-if="profile.exemplar">
            <CahierDonut
              class="stacked-donut bpe-profile-donut cahier-tooltip-trigger"
              :data-profile="profile.profile"
              :style="donutStyle(profile.exemplar)"
              :label-accessible="donutAccessibleLabel(profile)"
              :aria-describedby="`bpe-profile-donut-tooltip-${profile.profile}`"
            >
              <span>Exemple</span>
            </CahierDonut>
            <CahierFigureTooltip
              :id="`bpe-profile-donut-tooltip-${profile.profile}`"
              class="bpe-profile-donut-tooltip"
              :title="props.donutTooltipTitle"
              :rows="donutTooltipRows(profile)"
              popover
            />
          </template>
        </div>
        <span v-if="profile.exemplar" class="bpe-profile-exemplar">{{ profile.exemplar.label }}</span>
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
  grid-template-rows: repeat(4, max-content);
  column-gap: 0;
  row-gap: var(--space-2);
  margin: var(--space-1) var(--cahier-figure-grid-right) 0 var(--cahier-figure-grid-left);
}

.bpe-profile-column {
  display: grid;
  grid-row: span 4;
  grid-template-rows: subgrid;
  min-width: 0;
  justify-items: center;
  text-align: center;
}

.bpe-profile-label {
  display: flex;
  flex-direction: column;
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

.bpe-profile-donut-anchor {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  min-height: var(--cahier-donut-size);
}

.bpe-profile-donut-tooltip {
  top: calc(100% + 8px);
  left: 50%;
  transform: translate(-50%, -4px);
}

.bpe-profile-donut {
  margin: 0 auto;
}

.bpe-profile-exemplar {
  max-width: 16ch;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

@container cahier-page (max-width: 620px) {
  .bpe-profile-details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--space-3);
  }
}
</style>
