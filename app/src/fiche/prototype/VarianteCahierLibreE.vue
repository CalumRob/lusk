<script setup lang="ts">
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import type { CahierPagination } from './cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions?: readonly OptionContexteComparaison[]
}>()
</script>

<template>
  <VarianteCahierLibre
    :content="content"
    :pagination="pagination"
    :comparison-options="comparisonOptions"
    show-all-units
    show-map-prototype
    presentation="plain"
    network-figure-variant="traces"
  />
</template>
