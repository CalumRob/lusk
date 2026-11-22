<script setup lang="ts">
/** Bouton-icône — porté du prototype (0657b2fe) : AppIcon (lucide) avec un nom accessible obligatoire. */
import type { Component } from 'vue'

import AppIcon from '@/components/AppIcon.vue'

withDefaults(defineProps<{ icon: Component; label: string; size?: number }>(), { size: 16 })
</script>

<template>
  <button type="button" class="atelier-icone" :aria-label="label" :title="label">
    <AppIcon :icone="icon" :taille="size" aria-hidden="true" />
  </button>
</template>

<style scoped>
/* Rien ici ne doit traverser une frontière de composant. Les deux dimensions
   sont des propriétés héritées : la page règle la densité de ses boutons
   d'insertion sur l'ancêtre, sans avoir à percer ce style scopé. */
.atelier-icone {
  display: inline-grid;
  place-items: center;
  width: var(--atelier-icone-largeur, 32px);
  height: var(--atelier-icone-hauteur, 32px);
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.atelier-icone:hover { background: color-mix(in srgb, currentColor 8%, transparent); color: var(--red); }
.atelier-icone:active { background: color-mix(in srgb, currentColor 14%, transparent); }
.atelier-icone:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.atelier-icone:disabled { opacity: 0.3; cursor: default; background: none; color: var(--muted); }
</style>
