<script setup lang="ts">
/**
 * [PROTOTYPE #499 — JETABLE] Le commutateur fixe du bas — le seul moyen de
 * choisir une variante. Développement uniquement : le registre ne l'expose
 * pas hors `import.meta.env.DEV`.
 *
 * - affiche la clé + le nom de chaque variante, l'état actif en aria-pressed ;
 * - clic = ?variant=X (les AUTRES paramètres de requête sont conservés) ;
 * - ← / → au clavier cyclent les variantes ; un focus dans un contrôle
 *   éditable (input, textarea, select, contenteditable) n'est jamais
 *   intercepté ;
 * - porte le marquage visible « jetable » (#499).
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { VARIANTES, varianteDeUrl, clefVoisine } from './variantes'

const route = useRoute()
const router = useRouter()

const active = computed(() => varianteDeUrl(route.query.variant))

function choisir(clef: string): void {
  router.replace({ query: { ...route.query, variant: clef } })
}

function cycler(sens: 1 | -1): void {
  choisir(clefVoisine(active.value?.clef ?? null, sens))
}

function surTouche(evenement: KeyboardEvent): void {
  if (evenement.key !== 'ArrowLeft' && evenement.key !== 'ArrowRight') return
  const cible = evenement.target as HTMLElement | null
  if (
    cible &&
    (cible.isContentEditable ||
      cible.tagName === 'INPUT' ||
      cible.tagName === 'TEXTAREA' ||
      cible.tagName === 'SELECT')
  ) {
    return
  }
  evenement.preventDefault()
  cycler(evenement.key === 'ArrowRight' ? 1 : -1)
}

onMounted(() => window.addEventListener('keydown', surTouche))
onBeforeUnmount(() => window.removeEventListener('keydown', surTouche))
</script>

<template>
  <div class="commutateur-proto" role="toolbar" aria-label="Prototype #499 — variantes de fiche">
    <span class="proto-badge">PROTO #499 · jetable</span>
    <button
      v-for="variante in VARIANTES"
      :key="variante.clef"
      type="button"
      class="proto-bouton"
      :class="{ 'est-active': variante.clef === active?.clef }"
      :aria-pressed="variante.clef === active?.clef"
      @click="choisir(variante.clef)"
    >
      <strong>{{ variante.clef }}</strong>
      {{ variante.nom }}
    </button>
    <span class="proto-aide" aria-hidden="true">← → pour cycler</span>
  </div>
</template>

<style scoped>
.commutateur-proto {
  position: fixed;
  bottom: var(--space-4);
  left: 50%;
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-prominent);
  transform: translateX(-50%);
}

.proto-badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--text-primary);
  color: var(--surface-primary);
  font: 600 var(--text-caption)/1.4 var(--font-sans);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
  white-space: nowrap;
}

.proto-bouton {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font: var(--text-body-sm)/1.4 var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
}

.proto-bouton strong {
  font-variant-numeric: tabular-nums;
}

.proto-bouton:hover {
  color: var(--text-primary);
  border-color: var(--border-default);
}

.proto-bouton.est-active {
  background: var(--brand-100);
  border-color: var(--brand-500);
  color: var(--brand-900);
}

.proto-aide {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
