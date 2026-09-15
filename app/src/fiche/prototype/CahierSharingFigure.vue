<script setup lang="ts">
import { Bike, CarFront, Footprints, Route, ShieldCheck, Waypoints } from 'lucide-vue-next'
import { computed } from 'vue'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type {
  ContentFact,
  ExplorationTarget,
  SharingNetworksEvidence,
  CyclingOfferEvidence,
  SharingParkingEvidence,
} from '@/fiche/content/themeContent'
import { routePourCibleExploration } from '@/fiche/explorationHandoff'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierNetworkFigure from './CahierNetworkFigure.vue'

const props = defineProps<{
  evidence: SharingNetworksEvidence | CyclingOfferEvidence | SharingParkingEvidence
  targets: readonly ExplorationTarget[]
  networkFigureVariant?: 'traces'
}>()

type Reading = { key: string; fact: ContentFact }
type NetworkMode = 'walkTransit' | 'bike' | 'car'

const MODE_ICONS: Readonly<Record<NetworkMode, Component>> = {
  walkTransit: Footprints,
  bike: Bike,
  car: CarFront,
}

const MODE_TONES: Readonly<Record<NetworkMode, 't' | 'b' | 'c'>> = {
  walkTransit: 't',
  bike: 'b',
  car: 'c',
}

const CYCLING_ICONS: Readonly<Record<'protected' | 'shared', Component>> = {
  protected: ShieldCheck,
  shared: Waypoints,
}

const networks = computed(() =>
  props.evidence.kind === 'sharing-networks' ? props.evidence.networks : [],
)
const cyclingOffer = computed(() =>
  props.evidence.kind === 'cycling-offer' ? props.evidence : null,
)
const parking = computed(() =>
  props.evidence.kind === 'sharing-parking' ? props.evidence : null,
)

const networkLengthReadings = computed<Reading[]>(() =>
  networks.value.map((network) => ({ key: `${network.mode}-length`, fact: network.length })),
)
const cyclingRows = computed(() => {
  if (!cyclingOffer.value) return []
  return [
    {
      key: 'protected' as const,
      length: cyclingOffer.value.protectedLength,
      density: cyclingOffer.value.protectedDensity,
    },
    {
      key: 'shared' as const,
      length: cyclingOffer.value.sharedLength,
      density: cyclingOffer.value.sharedDensity,
    },
  ]
})
const parkingReadings = computed<Reading[]>(() => {
  if (!parking.value) return []
  return [
    { key: 'bike-spaces', fact: parking.value.bikeSpaces },
    { key: 'car-spaces', fact: parking.value.carSpaces },
  ]
})

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function fractionDigits(fact: ContentFact): number {
  return fact.fact.unit.includes(' / ') ? 2 : 1
}

function formatFact(fact: ContentFact): string {
  if (fact.fact.value === null) return '—'
  return fact.fact.unit === '%'
    ? `${formatNumber(fact.fact.value * 100, 0)} %`
    : formatNumber(fact.fact.value, fractionDigits(fact))
}

function numericValue(fact: ContentFact): number | null {
  return fact.fact.value !== null && Number.isFinite(fact.fact.value) ? Math.max(0, fact.fact.value) : null
}

function maximum(readings: readonly Reading[]): number {
  return Math.max(1, ...readings.map((reading) => numericValue(reading.fact) ?? 0))
}

function relativeWidth(fact: ContentFact, readings: readonly Reading[]): string {
  return `${((numericValue(fact) ?? 0) / maximum(readings)) * 100}%`
}

function routeFor(fact: ContentFact): RouteLocationRaw | null {
  const target = props.targets.find(
    (candidate) => candidate.key === fact.fact.key && candidate.detail === fact.fact.detail,
  )
  return target ? routePourCibleExploration(target) : null
}

function ariaForFact(fact: ContentFact): string {
  return `${fact.label} : ${formatFact(fact)}`
}

function ariaValue(reading: Reading): string {
  return `${reading.fact.label} : ${formatFact(reading.fact)}`
}

function networkAriaLabel(): string {
  return networks.value
    .map((network) => `${network.label}, ${formatFact(network.length)}`)
    .join(' · ')
}

function cyclingAriaLabel(): string {
  if (!cyclingOffer.value) return ''
  return [
    cyclingOffer.value.protectedLength,
    cyclingOffer.value.sharedLength,
    cyclingOffer.value.totalLength,
  ].map(ariaForFact).join(' · ')
}

function parkingAriaLabel(): string {
  if (!parking.value) return ''
  return [parking.value.bikeSpaces, parking.value.carSpaces, parking.value.bikePerCar]
    .map(ariaForFact)
    .join(' · ')
}

function modeTone(mode: NetworkMode): string {
  return MODE_TONES[mode]
}

function cyclingCompositionWidth(fact: ContentFact): string {
  const total = cyclingOffer.value ? numericValue(cyclingOffer.value.totalLength) : null
  return `${total && total > 0 ? ((numericValue(fact) ?? 0) / total) * 100 : 0}%`
}

function parkingShare(fact: ContentFact): string {
  const total = parkingReadings.value.reduce((sum, reading) => sum + (numericValue(reading.fact) ?? 0), 0)
  return `${total > 0 ? ((numericValue(fact) ?? 0) / total) * 100 : 0}%`
}
</script>

<template>
  <CahierNetworkFigure
    v-if="props.evidence.kind === 'sharing-networks' && props.networkFigureVariant === 'traces'"
    :evidence="props.evidence"
  />

  <CahierFigureFrame v-else-if="props.evidence.kind === 'sharing-networks'" class="sharing-figure-frame">
    <div class="sharing-figure-key" aria-hidden="true">
      <span class="sharing-figure-key-label">Trois réseaux</span>
      <span>Longueur</span>
    </div>

    <div class="sharing-network-matrix" role="img" :aria-label="networkAriaLabel()">
      <div
        v-for="network in props.evidence.networks"
        :key="network.mode"
        class="sharing-network-row"
        :class="`sharing-network-row--${network.mode}`"
      >
        <div class="sharing-network-mode">
          <component
            :is="MODE_ICONS[network.mode]"
            class="sharing-network-icon"
            :class="`sharing-tone--${modeTone(network.mode)}`"
            :size="19"
            :stroke-width="1.8"
            aria-hidden="true"
          />
          <span>{{ network.label }}</span>
        </div>

        <div class="sharing-network-measure sharing-network-length">
          <CahierFigureScalar
            class="sharing-reading sharing-network-reading"
            layout="inline"
            :show-label="false"
            :data-indicator="network.length.fact.key"
            :value="formatFact(network.length)"
            :label="network.length.label"
            :aria-label="ariaValue({ key: `${network.mode}-length`, fact: network.length })"
          >
            <template #reference>
              <CahierComparisonValue
                :fact="network.length.fact"
                :maximum-fraction-digits="fractionDigits(network.length)"
                :to="routeFor(network.length)"
              />
            </template>
          </CahierFigureScalar>
          <span
            class="sharing-network-track"
            :class="`sharing-tone-bg--${modeTone(network.mode)}`"
            aria-hidden="true"
          >
            <span class="sharing-network-fill" :style="{ width: relativeWidth(network.length, networkLengthReadings) }" />
          </span>
        </div>
      </div>
    </div>
  </CahierFigureFrame>

  <CahierFigureFrame v-else-if="props.evidence.kind === 'cycling-offer'" class="sharing-figure-frame">
    <div class="sharing-cycling-lead">
      <CahierFigureScalar
        class="sharing-reading sharing-cycling-reading sharing-cycling-total"
        :data-indicator="props.evidence.totalLength.fact.key"
        :data-detail="props.evidence.totalLength.fact.detail ?? undefined"
        :value="formatFact(props.evidence.totalLength)"
        :label="props.evidence.totalLength.label"
        :aria-label="ariaForFact(props.evidence.totalLength)"
      >
        <template #reference>
          <CahierComparisonValue
            :fact="props.evidence.totalLength.fact"
            :maximum-fraction-digits="fractionDigits(props.evidence.totalLength)"
            :to="routeFor(props.evidence.totalLength)"
          />
        </template>
      </CahierFigureScalar>
      <div class="sharing-cycling-rule" aria-hidden="true" />
      <div class="sharing-cycling-intro">
        <Route :size="18" stroke-width="1.7" aria-hidden="true" />
        <span>Une offre lisible par sa forme, pas seulement par son total.</span>
      </div>
    </div>

    <div class="sharing-composition" role="img" :aria-label="cyclingAriaLabel()">
      <div class="sharing-composition-track" aria-hidden="true">
        <span
          v-for="row in cyclingRows"
          :key="`segment-${row.key}`"
          class="sharing-composition-segment"
          :class="`sharing-composition-segment--${row.key}`"
          :style="{ width: cyclingCompositionWidth(row.length) }"
        />
      </div>
      <div class="sharing-composition-scale" aria-hidden="true">
        <span>Protégé</span>
        <span>Partagé</span>
        <span>Total</span>
      </div>
    </div>

    <div class="sharing-cycling-breakdown" :aria-label="props.evidence.cyclingReadingsLabel">
      <div v-for="row in cyclingRows" :key="row.key" class="sharing-cycling-row">
        <div class="sharing-cycling-label">
          <component :is="CYCLING_ICONS[row.key]" :size="17" stroke-width="1.8" aria-hidden="true" />
          <span>{{ row.length.label }}</span>
        </div>
        <CahierFigureScalar
          class="sharing-reading sharing-cycling-reading"
          layout="inline"
          :show-label="false"
          :data-indicator="row.length.fact.key"
          :data-detail="row.length.fact.detail ?? undefined"
          :value="formatFact(row.length)"
          :label="row.length.label"
          :aria-label="ariaForFact(row.length)"
        >
          <template #reference>
            <CahierComparisonValue
              :fact="row.length.fact"
              :maximum-fraction-digits="fractionDigits(row.length)"
              :to="routeFor(row.length)"
            />
          </template>
        </CahierFigureScalar>
        <CahierFigureScalar
          class="sharing-reading sharing-cycling-reading"
          layout="inline"
          :show-label="false"
          :data-indicator="row.density.fact.key"
          :data-detail="row.density.fact.detail ?? undefined"
          :value="formatFact(row.density)"
          :label="row.density.label"
          :aria-label="ariaForFact(row.density)"
        >
          <template #reference>
            <CahierComparisonValue
              :fact="row.density.fact"
              :maximum-fraction-digits="fractionDigits(row.density)"
              :to="routeFor(row.density)"
            />
          </template>
        </CahierFigureScalar>
      </div>
    </div>
  </CahierFigureFrame>

  <CahierFigureFrame v-else class="sharing-figure-frame">
    <div class="sharing-parking-lead">
      <CahierFigureScalar
        class="sharing-reading sharing-parking-reading sharing-parking-ratio"
        :data-indicator="props.evidence.bikePerCar.fact.key"
        :value="formatFact(props.evidence.bikePerCar)"
        :label="props.evidence.bikePerCar.label"
        :aria-label="ariaForFact(props.evidence.bikePerCar)"
      >
        <template #reference>
          <CahierComparisonValue
            :fact="props.evidence.bikePerCar.fact"
            :maximum-fraction-digits="fractionDigits(props.evidence.bikePerCar)"
            :to="routeFor(props.evidence.bikePerCar)"
          />
        </template>
      </CahierFigureScalar>
      <p v-if="props.evidence.ratioNote" class="sharing-ratio-note" role="note">
        {{ props.evidence.ratioNote }}
      </p>
    </div>

    <div class="sharing-parking-balance" role="img" :aria-label="parkingAriaLabel()">
      <div class="sharing-parking-values">
        <div
          v-for="(reading, index) in parkingReadings"
          :key="reading.key"
          class="sharing-parking-mode"
          :class="index === 0 ? 'sharing-parking-mode--bike' : 'sharing-parking-mode--car'"
        >
          <div class="sharing-parking-label">
            <Bike v-if="index === 0" :size="18" stroke-width="1.8" aria-hidden="true" />
            <CarFront v-else :size="18" stroke-width="1.8" aria-hidden="true" />
            <span>{{ reading.fact.label }}</span>
          </div>
          <CahierFigureScalar
            class="sharing-reading sharing-parking-reading"
            layout="inline"
            :show-label="false"
            :data-indicator="reading.fact.fact.key"
            :data-detail="reading.fact.fact.detail ?? undefined"
            :value="formatFact(reading.fact)"
            :label="reading.fact.label"
            :aria-label="ariaForFact(reading.fact)"
          >
            <template #reference>
              <CahierComparisonValue
                :fact="reading.fact.fact"
                :maximum-fraction-digits="fractionDigits(reading.fact)"
                :to="routeFor(reading.fact)"
              />
            </template>
          </CahierFigureScalar>
        </div>
      </div>
      <div class="sharing-parking-track" aria-hidden="true">
        <span
          v-for="(reading, index) in parkingReadings"
          :key="`parking-share-${reading.key}`"
          class="sharing-parking-segment"
          :class="index === 0 ? 'sharing-parking-segment--bike' : 'sharing-parking-segment--car'"
          :style="{ width: parkingShare(reading.fact) }"
        />
      </div>
    </div>
  </CahierFigureFrame>
</template>

<style scoped>
.sharing-figure-frame {
  display: grid;
  gap: var(--space-5);
}

.sharing-figure-key {
  display: grid;
  grid-template-columns: minmax(104px, 0.72fr) minmax(150px, 1fr);
  gap: var(--space-3);
  align-items: baseline;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--fine-rule);
  color: var(--cahier-default);
  font: var(--type-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  text-transform: uppercase;
}

.sharing-figure-key span:not(.sharing-figure-key-label) {
  text-align: right;
}

.sharing-figure-key-label {
  color: var(--ink);
  font-weight: 700;
}

.sharing-network-matrix {
  display: grid;
  gap: 0;
}

.sharing-network-row {
  display: grid;
  grid-template-columns: minmax(104px, 0.72fr) minmax(150px, 1fr);
  gap: var(--space-3);
  align-items: center;
  min-height: 82px;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--fine-rule);
}

.sharing-network-mode,
.sharing-cycling-label,
.sharing-parking-label {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  line-height: 1.3;
}

.sharing-cycling-label span,
.sharing-parking-label span {
  overflow-wrap: anywhere;
}

.sharing-cycling-label svg,
.sharing-parking-label svg {
  flex: 0 0 auto;
}

.sharing-tone--t { color: var(--cahier-mode-foot); }
.sharing-tone--b { color: var(--cahier-mode-bike); }
.sharing-tone--c { color: var(--cahier-mode-car); }

.sharing-network-measure {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.sharing-network-reading {
  align-items: baseline;
}

.sharing-network-track {
  display: block;
  height: 5px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.sharing-network-fill {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  background: currentColor;
}

.sharing-tone-bg--t { color: var(--cahier-mode-foot); }
.sharing-tone-bg--b { color: var(--cahier-mode-bike); }
.sharing-tone-bg--c { color: var(--cahier-mode-car); }

.sharing-cycling-lead {
  display: grid;
  grid-template-columns: minmax(130px, 0.8fr) 1px minmax(0, 1.5fr);
  gap: var(--space-5);
  align-items: center;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--fine-rule);
}

.sharing-cycling-total :deep(.cahier-figure-scalar-value) {
  color: var(--cahier-theme-strong);
  font-size: 1.35rem;
}

.sharing-cycling-rule {
  align-self: stretch;
  background: var(--fine-rule);
}

.sharing-cycling-intro {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--cahier-default);
  font: var(--type-figure-label);
  line-height: 1.45;
}

.sharing-composition {
  display: grid;
  gap: var(--space-2);
}

.sharing-composition-track,
.sharing-parking-track {
  display: flex;
  width: 100%;
  height: 13px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--paper-deep);
}

.sharing-composition-segment,
.sharing-parking-segment {
  min-width: 0;
  height: 100%;
}

.sharing-composition-segment + .sharing-composition-segment,
.sharing-parking-segment + .sharing-parking-segment {
  border-left: 2px solid var(--paper);
}

.sharing-composition-segment--protected { background: var(--cahier-theme); }
.sharing-composition-segment--shared { background: var(--cahier-mode-bike); }

.sharing-composition-scale {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  color: var(--cahier-default);
  font: var(--type-figure-label);
}

.sharing-composition-scale span:nth-child(2) { text-align: center; }
.sharing-composition-scale span:last-child { text-align: right; }

.sharing-cycling-breakdown {
  display: grid;
  gap: 0;
}

.sharing-cycling-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(100px, 0.65fr) minmax(100px, 0.65fr);
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--fine-rule);
}

.sharing-cycling-row:last-child { border-bottom: 0; }

.sharing-cycling-label svg { color: var(--cahier-theme-strong); }

.sharing-parking-lead {
  display: grid;
  grid-template-columns: minmax(150px, 0.85fr) minmax(0, 1.4fr);
  gap: var(--space-5);
  align-items: center;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--fine-rule);
}

.sharing-parking-ratio :deep(.cahier-figure-scalar-value) {
  color: var(--cahier-theme-strong);
  font-size: 1.35rem;
}

.sharing-ratio-note {
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-label);
  line-height: 1.45;
}

.sharing-parking-balance {
  display: grid;
  gap: var(--space-4);
}

.sharing-parking-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
}

.sharing-parking-mode {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.sharing-parking-mode--bike .sharing-parking-label { color: var(--cahier-mode-bike); }
.sharing-parking-mode--car .sharing-parking-label { color: var(--cahier-mode-car); }

.sharing-parking-track { height: 15px; }
.sharing-parking-segment--bike { background: var(--cahier-mode-bike); }
.sharing-parking-segment--car { background: var(--cahier-mode-car); }

@container cahier-page (max-width: 620px) {
  .sharing-figure-key,
  .sharing-network-row {
    grid-template-columns: minmax(88px, 0.7fr) minmax(110px, 1fr);
    gap: var(--space-2);
  }

  .sharing-cycling-lead,
  .sharing-parking-lead {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .sharing-cycling-rule { display: none; }

  .sharing-cycling-row {
    grid-template-columns: minmax(94px, 1fr) minmax(78px, 0.75fr) minmax(78px, 0.75fr);
    gap: var(--space-2);
  }

  .sharing-parking-values { gap: var(--space-3); }
}
</style>
