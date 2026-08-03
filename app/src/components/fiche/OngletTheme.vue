<script setup lang="ts">
/**
 * OngletTheme — one theme's tab content (ui-elements.md §ThemeBlock).
 * The shell's job is the theming (the theme -strong overline); C3 builds the
 * Démographie block (indicateurs + Story) in here. One theme visible at a
 * time — the ThemeTabs subheader is the navigation.
 */
import { computed } from 'vue'

import { NOMS_THEMES } from '@/fiche/onglets'
import type { Theme } from '@/payload/types'

const props = defineProps<{ theme: Theme }>()

const nomTheme = computed(() => NOMS_THEMES[props.theme])
</script>

<template>
  <article
    class="onglet-theme"
    :class="`onglet-theme--${theme}`"
    :style="{ '--couleur-overline': `var(--theme-${theme}-strong)` }"
  >
    <p class="onglet-theme-overline">{{ nomTheme }}</p>
    <p class="onglet-theme-vide">À venir.</p>
  </article>
</template>

<style scoped>
.onglet-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.onglet-theme-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-overline);
}

.onglet-theme-vide {
  margin: 0;
  color: var(--text-secondary);
}
</style>
