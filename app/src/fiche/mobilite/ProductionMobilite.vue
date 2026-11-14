<script setup lang="ts">
import ProductionMobiliteAedar from './ProductionMobiliteAedar.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { AedarFetchResult, AedarSummaryFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import type { ChapitreDemandStatus } from '@/fiche/content/demandInventory'
import type { ThemeContent } from '@/fiche/content/themeContent'
withDefaults(defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
  aedarSummaryData: AedarSummaryFetchResult | null
  aedarSummaryStatus: 'loading' | 'ready' | 'error'
  retryAedarSummary: () => void
  aedarReferenceTerritoire?: { type: AedarTerritoryType; id: string; nom: string } | null
  aedarReferenceData?: AedarSummaryFetchResult | null
  aedarReferenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
  nativeComparisonStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  nativeComparisonError?: string
  retryNativeComparison?: () => void
  /** #986 — the reader is on the AEDAR (page-1) chapter: its own reads may start. */
  aedarActive?: boolean
  /** #1008 — the visible chapter's admission state, owned by the demand planner. */
  chapitresStatut?: Readonly<Record<string, ChapitreDemandStatus>>
}>(), { aedarActive: true })
const emit = defineEmits<{ 'chapitre-visible': [anchor: string] }>()
</script>
<template>
  <ProductionMobiliteAedar
    :content="content"
    :pagination="pagination"
    :aedar-data="aedarData"
    :aedar-status="aedarStatus"
    :retry-aedar="retryAedar"
    :aedar-summary-data="aedarSummaryData"
    :aedar-summary-status="aedarSummaryStatus"
    :retry-aedar-summary="retryAedarSummary"
    :aedar-reference-territoire="aedarReferenceTerritoire"
    :aedar-reference-data="aedarReferenceData"
    :aedar-reference-status="aedarReferenceStatus"
    :native-comparison-status="nativeComparisonStatus"
    :native-comparison-error="nativeComparisonError"
    :retry-native-comparison="retryNativeComparison"
    :aedar-active="aedarActive"
    :chapitres-statut="chapitresStatut"
    @chapitre-visible="emit('chapitre-visible', $event)"
  />
</template>
