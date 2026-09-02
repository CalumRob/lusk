<script setup lang="ts">
defineProps<{
  style: Record<string, string>
  labelAccessible: string
}>()
</script>

<template>
  <div
    class="stacked-donut"
    :style="style"
    :aria-label="labelAccessible"
    role="img"
    tabindex="0"
  >
    <span class="stacked-donut-center">
      <slot />
    </span>
  </div>
</template>

<style scoped>
.stacked-donut {
  position: relative;
  width: var(--cahier-donut-size, clamp(92px, 12vw, 132px));
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  background: conic-gradient(
    var(--cahier-mode-foot) 0 var(--donut-walk),
    var(--cahier-mode-bike) var(--donut-walk) var(--donut-bike),
    var(--cahier-mode-car) var(--donut-bike) var(--donut-car),
    var(--paper-deep) var(--donut-car) 360deg
  );
}

.stacked-donut::after {
  position: absolute;
  inset: 10%;
  z-index: 1;
  border-radius: 50%;
  background: var(--paper);
  content: '';
}

.stacked-donut:focus-visible {
  outline: 2px solid var(--cahier-region-emphasis);
  outline-offset: 5px;
}

.stacked-donut-center {
  position: absolute;
  inset: 16%;
  z-index: 2;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.1;
  text-align: center;
}
</style>
