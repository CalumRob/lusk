<template>
  <section class="page methodologie">
    <h1 class="methodologie__titre">Sources &amp; Méthodes</h1>
    <p class="methodologie__intro">
      Les sources, définitions et la fraîcheur des données seront documentées ici.
    </p>

    <div class="etat-vide">
      <AppIcon :icone="BookOpen" :taille="28" class="etat-icone" />
      <p class="etat-texte">La table des vintages et les notes de reproductibilité prendront place ici.</p>
      <RouterLink class="etat-action" to="/">Retour à l'accueil</RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * Sources & Méthodes (/methodologie — site-map.md). Shell only (D4): the
 * route must exist and render a minimal, honest shell — content is deferred
 * (decided 2026-08-03). The empty state is the ui-elements pattern (icon +
 * one line + action); no construction banner (principles.md §1). The
 * editorial layout (layouts.md §5) is tightened to 900px for the report
 * voice.
 */
import { BookOpen } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
</script>

<style scoped>
.methodologie {
  max-width: 900px;
}

.methodologie__titre {
  margin: 0 0 var(--space-4);
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.methodologie__intro {
  margin: 0 0 var(--space-8);
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.etat-vide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.etat-icone {
  color: var(--text-tertiary);
}

.etat-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.etat-action {
  font: var(--text-body-sm);
  font-weight: 600;
}
</style>
