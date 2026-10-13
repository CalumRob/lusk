<script setup lang="ts">
import { Clock3 } from 'lucide-vue-next'
</script>

<template>
  <span class="cahier-travel-time-label type-figure-label">
    <Clock3 class="cahier-travel-time-label__icon" :size="16" stroke-width="2" aria-hidden="true" />
    Temps de trajet
  </span>
</template>

<style scoped>
.cahier-travel-time-label { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--cahier-default); font: var(--type-figure-label); letter-spacing: var(--type-figure-label-tracking); }
.cahier-travel-time-label__icon { flex: 0 0 auto; }
</style>
