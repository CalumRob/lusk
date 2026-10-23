<script setup lang="ts">
const props = withDefaults(defineProps<{
  imageUrl: string
  imageAlt: string
  accessibleName: string
  number: string
  loaded: boolean
  unavailable: boolean
  cycling?: boolean
}>(), { cycling: false })

const emit = defineEmits<{
  inspect: []
  loaded: []
  unavailable: []
}>()
</script>

<template>
  <button
    type="button"
    class="map-viewport"
    :class="{ 'map-viewport--cycling': props.cycling }"
    :aria-label="props.accessibleName"
    @click="emit('inspect')"
  >
    <span class="map-panel-number" aria-hidden="true">{{ props.number }}</span>
    <img
      v-if="!props.unavailable"
      :src="props.imageUrl"
      :alt="props.imageAlt"
      @load="emit('loaded')"
      @error="emit('unavailable')"
    />
    <span v-if="!props.loaded && !props.unavailable" role="status" class="map-loading">Chargement de la carte…</span>
    <span v-else-if="props.unavailable" role="status">Carte indisponible</span>
  </button>
</template>

<style scoped>
.map-viewport {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  padding: 0;
  border: var(--cahier-map-circle-border) solid var(--mode-ring);
  border-radius: 50%;
  background: color-mix(in srgb, var(--cahier-theme) 8%, var(--paper));
  cursor: zoom-in;
}

.map-viewport:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 3px;
}

.map-viewport img {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: inherit;
  background: #f8fbfb;
  object-fit: cover;
}

.map-panel-number {
  position: absolute;
  z-index: 1;
  top: 9px;
  left: 11px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  background: var(--editorial-paper);
  color: var(--color-figure-map-label);
  font: var(--text-caption);
  font-variant-numeric: tabular-nums;
  letter-spacing: normal;
}

.map-loading {
  position: absolute;
  inset: auto 0 8px;
  color: var(--muted);
  font: var(--text-caption);
  text-align: center;
}

.map-viewport--cycling {
  border-color: transparent;
  background: linear-gradient(var(--paper), var(--paper)) padding-box,
    linear-gradient(135deg, var(--cahier-cycle-protected), var(--cahier-cycle-shared)) border-box;
}
</style>
