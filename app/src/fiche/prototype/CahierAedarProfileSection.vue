<script setup lang="ts">
import type { AedarEquipmentProfileEvidence } from '@/fiche/content/themeContent'
import AedarEquipmentWaffleCahier from './AedarEquipmentWaffleCahier.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierProse from './CahierProse.vue'
import { useAedarSectionContext } from './aedarSectionContext'
defineProps<{ evidence: AedarEquipmentProfileEvidence; title: string }>()
const { selectedHorizon } = useAedarSectionContext()
</script>

<template>
  <div class="evidence-side evidence-figure aedar-equipment-profile-evidence">
    <AedarEquipmentWaffleCahier :evidence="evidence" :title="title" v-model:selected-horizon="selectedHorizon" />
  </div>
  <CahierProse class="argument-copy" data-aedar-profile-explanation :blocks="evidence.prose" />
  <CahierEvidenceSource v-if="evidence.source" :source="evidence.source" />
</template>

<style scoped>
.cahier--indexed-sections .argument-copy { text-align: left; }
</style>
