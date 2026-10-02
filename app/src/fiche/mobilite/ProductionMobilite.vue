<script setup lang="ts">
/** Production composition of the existing evidence-led Mobilité reading. */
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions: readonly OptionContexteComparaison[]
  accessStatus: 'loading' | 'ready' | 'error'
  retryAccess: () => void
  buildingStatus: 'loading' | 'ready' | 'error'
  retryBuilding: () => void
}>()
</script>

<template>
  <VarianteCahierLibre
    :content="content"
    :pagination="pagination"
    :comparison-options="comparisonOptions"
    :access-status="accessStatus"
    :retry-access="retryAccess"
    :building-status="buildingStatus"
    :retry-building="retryBuilding"
    show-all-units
    presentation="plain"
    network-figure-variant="traces"
  />
</template>
