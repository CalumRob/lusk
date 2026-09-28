<script setup lang="ts">
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import type { CahierPagination } from './cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions?: readonly OptionContexteComparaison[]
  accessStatus?: 'loading' | 'ready' | 'error'
  retryAccess?: () => void
  buildingStatus?: 'loading' | 'ready' | 'error'
  retryBuilding?: () => void
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
    show-map-prototype
    presentation="plain"
    network-figure-variant="traces"
  />
</template>
