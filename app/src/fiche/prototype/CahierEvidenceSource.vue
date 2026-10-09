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

<style scoped>
.cahier-evidence-source { margin: 0; color: var(--cahier-default); font-size: 10px; line-height: 1.1; overflow-wrap: anywhere; }
.cahier-evidence-source a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 2px; }
@media (max-width: 760px) { .cahier-evidence-source { font-size: 14px; line-height: 1.4; } }
</style>
