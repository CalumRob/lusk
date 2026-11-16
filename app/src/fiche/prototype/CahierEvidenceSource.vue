<script setup lang="ts">
import './cahierEvidenceSource.css'
import type { AedarEvidenceSource } from '@/fiche/content/themeContent'

defineProps<{ source: AedarEvidenceSource | null; pending?: boolean }>()
</script>

<template>
  <p v-if="source || pending" class="cahier-evidence-source" :class="{ 'cahier-evidence-source--pending': pending && !source }" :aria-hidden="!source || undefined">
    <template v-if="source">
    <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
    {{ source.version }}
    <span v-if="source.credit"> · {{ source.credit }}</span>
    </template>
  </p>
</template>
