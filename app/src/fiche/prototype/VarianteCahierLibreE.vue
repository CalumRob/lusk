<script setup lang="ts">
import VarianteCahierLibre from './VarianteCahierLibre.vue'
import type { CahierPagination } from './cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'

defineProps<{
  content: ThemeContent
  pagination: CahierPagination
}>()
</script>

<template>
  <VarianteCahierLibre
    :content="content"
    :pagination="pagination"
    show-all-units
    show-map-prototype
    presentation="plain"
    network-figure-variant="traces"
  />
</template>
