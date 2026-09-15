<script setup lang="ts">
/**
 * Adapter from the Réseaux evidence contract to the shared summary-bar figure.
 * The figure grammar remains owned by CahierSummaryPlot; this component only
 * supplies the network-specific labels and the three mode facts.
 */
import { Bike, CarFront, Footprints } from 'lucide-vue-next'
import { computed } from 'vue'
import type { Component } from 'vue'

import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import type {
  ContentFact,
  ContentModeFacts,
  SharingNetworksEvidence,
} from '@/fiche/content/themeContent'
import {
  MOBILITE_RESEAU_MODE_LABELS,
} from '@/fiche/content/territoryFacts'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierSummaryPlot from './CahierSummaryPlot.vue'

const props = defineProps<{
  evidence: SharingNetworksEvidence
}>()

type NetworkMode = 'walkTransit' | 'bike' | 'car'

const NETWORK_MODE_ICONS: Readonly<Record<NetworkMode, Component>> = {
  walkTransit: Footprints,
  bike: Bike,
  car: CarFront,
}

const NETWORK_LEGEND: readonly FigureLegendEntry[] = [
  { key: 'walkTransit', label: MOBILITE_RESEAU_MODE_LABELS.walkTransit, marker: 'icon', iconKey: 'walkTransit', tone: 't' },
  { key: 'bike', label: MOBILITE_RESEAU_MODE_LABELS.bike, marker: 'icon', iconKey: 'bike', tone: 'b' },
  { key: 'car', label: MOBILITE_RESEAU_MODE_LABELS.car, marker: 'icon', iconKey: 'car', tone: 'c' },
]

const networks = computed(() => new Map(props.evidence.networks.map((network) => [network.mode, network])))

function networkFactFor(mode: NetworkMode): ContentFact {
  const network = networks.value.get(mode)
  if (!network) throw new Error(`Réseaux incomplet : mode « ${mode} » absent`)
  return network.length
}

const plotValues = computed<ContentModeFacts>(() => ({
  walkTransit: networkFactFor('walkTransit'),
  bike: networkFactFor('bike'),
  car: networkFactFor('car'),
}))
</script>

<template>
  <CahierFigureFrame class="network-figure">
    <CahierSummaryPlot
      metric="network"
      axis-title="km / 1 000 hab."
      :values="plotValues"
      :territory-name="props.evidence.territoryName"
      :type-count="null"
      :mode-labels="MOBILITE_RESEAU_MODE_LABELS"
      show-group-labels
    />
    <CahierFigureLegend
      :entries="NETWORK_LEGEND"
      :icons="NETWORK_MODE_ICONS"
      label="Modes du réseau"
    />
  </CahierFigureFrame>
</template>

<style scoped>
.network-figure {
  display: grid;
  gap: var(--space-4);
}
</style>
