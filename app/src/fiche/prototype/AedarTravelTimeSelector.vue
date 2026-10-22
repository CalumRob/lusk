<script setup lang="ts">
import { AEDAR_EQUIPMENT_BUCKET_HORIZONS } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import CahierTravelTimeLabel from './CahierTravelTimeLabel.vue'

const props = defineProps<{
  modelValue: AedarEquipmentHorizon
  label: string
}>()
const emit = defineEmits<{
  'update:modelValue': [horizon: AedarEquipmentHorizon]
}>()
</script>

<template>
  <div class="aedar-travel-time-selector" role="group" :aria-label="props.label">
    <CahierTravelTimeLabel />
    <div class="aedar-travel-time-selector-options">
      <button
        v-for="horizon in AEDAR_EQUIPMENT_BUCKET_HORIZONS"
        :key="horizon"
        type="button"
        :value="horizon"
        :aria-label="`${horizon} minutes`"
        :aria-pressed="props.modelValue === horizon"
        @click="emit('update:modelValue', horizon)"
      >{{ horizon }} min</button>
    </div>
  </div>
</template>

<style scoped>
.aedar-travel-time-selector { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.aedar-travel-time-selector-options { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); }
.aedar-travel-time-selector-options button { min-height: 36px; padding: var(--space-2) var(--space-3); border: 0; border-radius: 0; background: transparent; color: var(--text-secondary); font: var(--type-figure-label); text-decoration: underline; text-underline-offset: 0.2em; cursor: pointer; }
.aedar-travel-time-selector-options button[aria-pressed='true'] { color: var(--text-primary); font-weight: 700; }
.aedar-travel-time-selector-options button:hover { text-decoration-color: currentColor; }
.aedar-travel-time-selector button:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
</style>
