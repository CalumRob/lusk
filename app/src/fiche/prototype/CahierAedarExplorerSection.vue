<script setup lang="ts">
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import AedarEquipmentExplorerCahier from './AedarEquipmentExplorerCahier.vue'
import { useAedarSectionContext } from './aedarSectionContext'
defineProps<{ evidence: AedarEquipmentExplorerEvidence }>()
const { selectedModes, selectedHorizon, comparisonVisible, chapterActive } = useAedarSectionContext()
</script>

<template>
  <div class="evidence-side evidence-figure aedar-equipment-explorer-evidence">
    <AedarEquipmentExplorerCahier
      :evidence="evidence"
      :chapter-active="chapterActive"
      v-model:selected-modes="selectedModes"
      v-model:selected-horizon="selectedHorizon"
      v-model:comparison-visible="comparisonVisible"
    />
  </div>
</template>
