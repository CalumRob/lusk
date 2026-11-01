<script setup lang="ts">
import ProductionMobiliteAedar from './ProductionMobiliteAedar.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { AedarFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'
defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions: readonly OptionContexteComparaison[]
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
  aedarReferenceTerritoire?: { type: AedarTerritoryType; id: string; nom: string } | null
  aedarReferenceData?: AedarFetchResult | null
  aedarReferenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
}>()
</script>
<template>
  <ProductionMobiliteAedar
    :content="content"
    :pagination="pagination"
    :comparison-options="comparisonOptions"
    :aedar-data="aedarData"
    :aedar-status="aedarStatus"
    :retry-aedar="retryAedar"
    :aedar-reference-territoire="aedarReferenceTerritoire"
    :aedar-reference-data="aedarReferenceData"
    :aedar-reference-status="aedarReferenceStatus"
  />
</template>
