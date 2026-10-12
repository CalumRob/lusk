<script setup lang="ts">
import type { AedarEvidenceSource } from '@/fiche/content/themeContent'

defineProps<{ source: AedarEvidenceSource }>()
</script>

<template>
  <p class="cahier-evidence-source">
    <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
    {{ source.version }}
    <span v-if="source.credit"> · {{ source.credit }}</span>
  </p>
</template>

<style src="./cahierEvidenceSource.css"></style>
