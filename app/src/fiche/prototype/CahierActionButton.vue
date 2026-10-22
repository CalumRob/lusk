<template>
  <button class="cahier-action-button" type="button">
    <slot />
  </button>
</template>

<style scoped>
.cahier-action-button {
  min-height: 36px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in oklab, var(--cahier-default) 24%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--red, var(--cahier-theme-strong));
  font: var(--type-figure-label);
  cursor: pointer;
}

.cahier-action-button:hover {
  background: color-mix(in srgb, var(--cahier-theme) 8%, transparent);
}

.cahier-action-button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
