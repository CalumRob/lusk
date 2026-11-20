<script setup lang="ts">
/** PROTOTYPE — an icon-only control: AppIcon (lucide) with a mandatory accessible name and tooltip. */
import type { Component } from 'vue'

import AppIcon from '@/components/AppIcon.vue'

defineProps<{ icon: Component; label: string; size?: number }>()
</script>

<template>
  <button type="button" class="at-icon" :aria-label="label" :title="label">
    <AppIcon :icone="icon" :taille="size ?? 16" aria-hidden="true" />
  </button>
</template>

<style>
.at-icon {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.at-icon:hover { background: color-mix(in srgb, currentColor 8%, transparent); color: var(--red); }
.at-icon:active { background: color-mix(in srgb, currentColor 14%, transparent); }
.at-icon:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
</style>
