<script setup lang="ts">
import { computed } from 'vue'
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import { aedarTimeRampEvidence } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { ThemeContent, AedarAccessSection } from '@/fiche/content/themeContent'
import type { CahierPagination } from './cahierPagination'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

const props = defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions: readonly OptionContexteComparaison[]
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
}>()

const transformed = computed(() => {
  if (!props.aedarData || props.aedarData.status !== 'ready') return props.content
  const virtualResponse = {
    territory: { territory_type: props.content.territory.type, territory_id: props.content.territory.code },
    content_version: props.aedarData.contentVersion,
    reference_content_version: props.aedarData.contentVersion,
    limit: props.aedarData.facts.length + 1,
    offset: 0,
    facts: props.aedarData.facts,
  }
  const ramps = aedarTimeRampEvidence(virtualResponse, {
    territory: { type: props.content.territory.type, id: props.content.territory.code },
    mode: 'car',
    modeLabel: 'Voiture',
  })
  const evidence = {
    kind: 'aedar-access' as const,
    territory: { code: props.content.territory.code, name: props.content.territory.name },
    horizonMinutes: 15,
    ramps,
    availability: ramps.every((ramp) => ramp.availability === 'complete') ? 'complete' as const : 'incomplete' as const,
    provenance: props.aedarData.provenance.sources.map((source) => source.source_id),
    figureLecture: [],
  }
  const section: AedarAccessSection = {
    key: 'aedar-access',
    label: 'Accès aux services — prototype AEDAR',
    availability: evidence.availability,
    indicators: [],
    evidence,
    provenance: [...evidence.provenance],
    lecture: null,
    explorationTargets: [],
  }
  const first = props.content.units[0]
  return { ...props.content, units: [{ ...first, sections: [section] }, ...props.content.units.slice(1)] } as unknown as ThemeContent
})
</script>

<template>
  <div v-if="props.aedarStatus !== 'ready'" class="aedar-state" :aria-busy="props.aedarStatus === 'loading'">
    <p v-if="props.aedarStatus === 'loading'" role="status">Chargement des agrégats AEDAR…</p>
    <div v-else role="alert">
      <p>Les données AEDAR ne sont pas disponibles.</p>
      <button type="button" @click="props.retryAedar">Réessayer</button>
    </div>
  </div>
  <VarianteCahierLibre
    v-else
    :content="transformed"
    :pagination="props.pagination"
    :comparison-options="props.comparisonOptions"
    show-all-units
    presentation="plain"
    network-figure-variant="traces"
    aedar-access-enabled
  />
</template>

<style scoped>
.aedar-state { padding: var(--space-8); text-align: center; color: var(--muted); }
.aedar-state button { margin-top: var(--space-4); padding: var(--space-2) var(--space-4); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-primary); cursor: pointer; }
.aedar-state button:hover { background: var(--surface-tertiary); }
</style>
