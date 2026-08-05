<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'

import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'

const route = useRoute()

/** Full-bleed tool pages (e.g. /carte — issue #67) own the viewport: no
    footer, so the page never scrolls as a whole. */
const afficherPied = computed(() => route.meta.sansPied !== true)
</script>

<template>
  <div class="app-shell">
    <a class="lien-evitement" href="#contenu-principal">Passer au contenu</a>
    <AppHeader />
    <main class="app-main" id="contenu-principal">
      <RouterView />
    </main>
    <AppFooter v-if="afficherPied" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.lien-evitement {
  position: absolute;
  top: -100px;
  left: var(--space-4);
  z-index: var(--z-toast);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
}

.lien-evitement:focus {
  top: var(--space-4);
}
</style>
