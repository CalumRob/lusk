<script setup lang="ts">
/**
 * AppFooter (site-map.md §Footer): one serif attribution line, the freshness
 * line computed from the payload via ligneFraicheur (the payload is fetched
 * once per session by usePayload — shared with the fiche view), links to
 * Méthodes, À propos and calumrobertson.fr.
 *
 * The wait-set of the shell (T3, #299) — territoires + run-report — gates
 * nothing visible here (the footer never renders a skeleton), but it scopes
 * `erreur` to the shell's own files: a background failure elsewhere can never
 * mask the real freshness line. The freshness line degrades honestly: the
 * static-rhythm claim while run-report hasn't landed and on error (never a
 * pretend freshness). The line links to the vintage table section of
 * /methodologie (site-map.md §Cross-links).
 */
import { computed } from 'vue'

import { ligneFraicheur } from '@/payload/selectors'
import { usePayload } from '@/payload/usePayload'

// La coquille ne bloque que sur la référence + le rapport de run (T3, #299) :
// la fraîcheur apparaît avec run-report, jamais en attente du full payload.
const { payload, erreur } = usePayload({ attendre: ['territoires', 'run-report'] })

const ligneFraicheurAffichée = computed(() => {
  if (erreur.value) return 'Données actualisées chaque semaine'
  return payload.value ? ligneFraicheur(payload.value) : null
})
</script>

<template>
  <footer class="pied">
    <div class="pied-interieur">
      <p class="pied-attribution">
        Conçu par
        <a
          href="https://calumrobertson.fr"
          target="_blank"
          rel="noopener noreferrer"
        >Calum Robertson</a>
        — Docteur en économie urbaine.
      </p>

      <RouterLink
        v-if="ligneFraicheurAffichée"
        :to="{ path: '/methodologie' }"
        class="pied-fraicheur"
      >{{ ligneFraicheurAffichée }}</RouterLink>
      <div v-else class="squelette squelette--fraicheur" role="status" aria-label="Chargement des données" />

      <nav class="pied-liens" aria-label="Liens du pied de page">
        <RouterLink to="/methodologie">Sources &amp; Méthodes</RouterLink>
        <RouterLink to="/a-propos">À propos</RouterLink>
        <a
          href="https://calumrobertson.fr"
          target="_blank"
          rel="noopener noreferrer"
        >calumrobertson.fr</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.pied {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-primary);
  margin-top: var(--space-16);
}

.pied-interieur {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile);
}

.pied-attribution {
  margin: 0;
  font: 400 0.875rem/1.5 var(--font-serif);
  color: var(--text-secondary);
}

.pied-fraicheur {
  width: fit-content;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.squelette--fraicheur {
  width: 220px;
  height: 0.75rem;
}

.pied-liens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  font: var(--text-body-sm);
}

.pied-liens a {
  color: var(--text-secondary);
}

.pied-liens a:hover {
  color: var(--accent-hover);
}
</style>
