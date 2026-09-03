<script setup lang="ts">
defineProps<{
  label: string | null
}>()
</script>

<template>
  <p v-if="label" class="cahier-comparison-note" role="note">
    <strong class="cahier-comparison-note__label">Groupe comparé</strong> : {{ label }}
  </p>
</template>

<style scoped>
.cahier-comparison-note {
  max-width: 42rem;
  margin: var(--space-2) auto 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  line-height: 1.3;
  text-align: center;
  overflow-wrap: anywhere;
}

.cahier-comparison-note__label {
  color: var(--cahier-region-emphasis);
}
</style>
