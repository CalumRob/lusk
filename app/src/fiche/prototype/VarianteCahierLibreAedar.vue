<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import { fetchAedarDiversityLossMapLegend } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarDiversityLossMapMetadata } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { CahierPagination } from './cahierPagination'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

const props = defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions: readonly OptionContexteComparaison[]
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
  /** Single published reference territory behind the comparison lines (never a cohort). */
  aedarReferenceTerritoire?: { type: AedarTerritoryType; id: string; nom: string } | null
  aedarReferenceData?: AedarFetchResult | null
  aedarReferenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
}>()

const lossMapMetadata = ref<AedarDiversityLossMapMetadata>({ status: 'loading', legend: null })
let lossMapMetadataRequest = 0

watch(() => `${props.content.territory.type}/${props.content.territory.code}`, async () => {
  const request = ++lossMapMetadataRequest
  const territory = props.content.territory
  lossMapMetadata.value = { status: 'loading', legend: null }
  try {
    const legend = await fetchAedarDiversityLossMapLegend(territory)
    if (request === lossMapMetadataRequest) lossMapMetadata.value = { status: 'ready', legend }
  } catch {
    if (request === lossMapMetadataRequest) lossMapMetadata.value = { status: 'unavailable', legend: null }
  }
}, { immediate: true })

const transformed = computed(() => {
  if (!props.aedarData || props.aedarData.status !== 'ready') return props.content
  const focal = props.aedarData
  const referenceTerritoire = props.aedarReferenceTerritoire ?? null
  const referenceData = props.aedarReferenceData ?? null
  // The reference only backs comparison lines when it is the same published version as the focal aggregates.
  const reference = referenceTerritoire && referenceData && referenceData.status === 'ready' && referenceData.contentVersion === focal.contentVersion
    ? { data: referenceData, territory: { type: referenceTerritoire.type, id: referenceTerritoire.id }, label: referenceTerritoire.nom }
    : null
  const sections = aedarPrototypeSections(focal, props.content.territory, {
    reference,
    lossMapMetadata: lossMapMetadata.value,
  })
  const carOverview = sections.find((section) => section.key === 'aedar-car-overview')
  const introduction = carOverview?.evidence?.kind === 'aedar-car-overview'
    ? carOverview.evidence.unitIntroduction
    : []
  const first = props.content.units[0]
  return { ...props.content, units: [{ ...first, introduction, rundown: [], sections }, ...props.content.units.slice(1)] } as unknown as ThemeContent
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
