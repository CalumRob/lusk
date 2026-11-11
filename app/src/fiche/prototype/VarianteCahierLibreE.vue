<script setup lang="ts">
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import type { CahierPagination } from './cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'

defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  accessStatus?: 'loading' | 'ready' | 'error'
  retryAccess?: () => void
  buildingStatus?: 'loading' | 'ready' | 'error'
  retryBuilding?: () => void
  nativeComparisonStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  nativeComparisonError?: string
  retryNativeComparison?: () => void
}>()
</script>

<template>
  <VarianteCahierLibre
    :content="content"
    :pagination="pagination"
    :access-status="accessStatus"
    :retry-access="retryAccess"
    :building-status="buildingStatus"
    :retry-building="retryBuilding"
    :native-comparison-status="nativeComparisonStatus"
    :native-comparison-error="nativeComparisonError"
    :retry-native-comparison="retryNativeComparison"
    show-all-units
    show-map-prototype
    presentation="plain"
    network-figure-variant="traces"
  />
</template>
