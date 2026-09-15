<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
  }>(),
  { label: 'Lecture' },
)
</script>

<template>
  <details class="cahier-figure-lecture">
    <summary>{{ label }}</summary>
    <div class="cahier-figure-lecture__content">
      <slot />
    </div>
  </details>
</template>

<style src="./cahierFigure.css"></style>

<style>
.cahier-figure-lecture {
  margin-top: 12px;
  color: var(--cahier-default);
  font-size: var(--type-figure-lecture-size);
  letter-spacing: normal;
}

.cahier-figure-lecture summary {
  cursor: pointer;
  color: var(--cahier-theme-strong);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cahier-figure-lecture summary:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 4px;
}

.cahier-figure-lecture__content {
  max-width: 62ch;
  margin-top: 8px;
  line-height: 1.45;
}

.cahier-figure-lecture__content :first-child {
  margin-top: 0;
}
</style>
