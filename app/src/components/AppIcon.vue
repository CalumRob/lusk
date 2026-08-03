<script setup lang="ts">
/**
 * AppIcon — the lucide-vue-next wrapper (DESIGN.md §5): sized, colored via
 * tokens, no emojis anywhere. Pass `libelle` for a meaningful icon (removes
 * aria-hidden); decorative icons stay silent.
 */
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icone: Component
    taille?: number
    libelle?: string
  }>(),
  { taille: 20 },
)
</script>

<template>
  <component :is="icone" :size="taille" :aria-label="libelle ?? undefined" />
</template>
