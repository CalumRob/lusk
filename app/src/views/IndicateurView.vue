<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import IndicateurPage from './IndicateurPage.vue'

const route = useRoute()
const pageKey = computed(() => `${String(route.params.theme)}/${String(route.params.indicator)}`)
</script>

<template>
  <IndicateurPage :key="pageKey" />
</template>
