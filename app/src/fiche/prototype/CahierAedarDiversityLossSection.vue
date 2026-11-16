<script setup lang="ts">
import type { AedarDiversityLossEvidence } from '@/fiche/content/themeContent'
import AedarDiversityLossMapsCahier from './AedarDiversityLossMapsCahier.vue'
import { useAedarSectionContext } from './aedarSectionContext'
defineProps<{ evidence: AedarDiversityLossEvidence }>()
const { chapterActive } = useAedarSectionContext()
</script>

<template>
  <AedarDiversityLossMapsCahier :evidence="evidence" :active="chapterActive" />
</template>
