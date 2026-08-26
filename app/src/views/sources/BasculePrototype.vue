<script setup lang="ts">
/**
 * ⚠️ PROTOTYPE JETABLE (#500) — la bascule de variantes, DÉVELOPPEMENT UNIQUEMENT.
 *
 * Barre flottante fixe en bas d'écran : trois boutons (A · Registre /
 * B · Dossiers / C · Thèmes), précédent/suivant, et cyclage clavier
 * ←/→ quand le focus est dans la barre. Le changement écrit `variant`
 * dans l'URL (`router.replace`) en PRÉSERVANT les autres paramètres de
 * requête — l'état reste partageable/rechargeable.
 *
 * Rendue seulement derrière `import.meta.env.DEV` (voir SourcesView) :
 * elle ne doit jamais apparaître dans un build de production.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { VARIANTES, type Variante } from './prototype'

const props = defineProps<{ actuelle: Variante }>()
const emit = defineEmits<{ changer: [variante: Variante] }>()

const route = useRoute()
const router = useRouter()

const LIBELLES: Record<Variante, string> = {
  A: 'A · Registre',
  B: 'B · Dossiers',
  C: 'C · Thèmes',
}

function appliquer(variante: Variante): void {
  if (variante === props.actuelle) return
  // L'URL reste l'état : les autres paramètres de requête sont préservés.
  router.replace({ query: { ...route.query, variant: variante } })
  emit('changer', variante)
}

const indexActuel = computed(() => VARIANTES.indexOf(props.actuelle))

/** Cyclage clavier ←/→ — le focus reste dans la barre, l'URL suit. */
function auClavier(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const prochain = (indexActuel.value + delta + VARIANTES.length) % VARIANTES.length
  appliquer(VARIANTES[prochain])
}
</script>

<template>
  <nav class="bascule" aria-label="Variantes de la table Sources (prototype)" @keydown="auClavier">
    <span class="bascule__etiquette">Prototype #500</span>
    <button
      v-for="(variante, index) in VARIANTES"
      :key="variante"
      type="button"
      class="bascule__bouton"
      :class="{ 'bascule__bouton--actif': variante === actuelle }"
      :aria-pressed="variante === actuelle"
      @click="appliquer(variante)"
    >
      {{ LIBELLES[variante] }}
      <span v-if="index === indexActuel" class="masque">(active)</span>
    </button>
    <span class="bascule__indice" aria-hidden="true">←/→</span>
  </nav>
</template>

<style scoped>
.bascule {
  position: fixed;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-prominent);
}
.bascule__etiquette {
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--status-warning);
  color: #fff;
  font: var(--text-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.bascule__bouton {
  padding: var(--space-1) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font: var(--text-body-sm);
  font-weight: 600;
  cursor: pointer;
}
.bascule__bouton:hover { color: var(--text-primary); }
.bascule__bouton--actif {
  border-color: var(--brand-200);
  background: var(--brand-100);
  color: var(--brand-900);
}
.bascule__bouton:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
.bascule__indice { color: var(--text-tertiary); font: var(--text-caption); }

@media (max-width: 480px) {
  .bascule { max-width: calc(100vw - 2 * var(--space-4)); flex-wrap: wrap; justify-content: center; border-radius: var(--radius-lg); }
}

.masque {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
