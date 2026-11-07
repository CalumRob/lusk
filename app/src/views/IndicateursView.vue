<script setup lang="ts">
/**
 * Catalogue /indicateurs (#409), servi par le contenu éditorial stable de
 * l'application. Producer discovery admits route identities and factual
 * labels; catalogue membership/order stay app-owned and never infer facts.
 */
import { computed, nextTick, onMounted, ref } from 'vue'

import { chargerRessourcesCatalogueIndicateurs, groupesCatalogue } from '@/indicateurs/catalogue'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'

const ressources = ref<SemanticResourceDeclaration[] | null>(null)
const statut = ref<'loading' | 'error' | 'ready'>('loading')
const chargement = ref(false)
const succesReessai = ref(false)
const boutonReessai = ref<HTMLButtonElement | null>(null)
const statutSuccesReessai = ref<HTMLElement | null>(null)
const groupes = computed(() => ressources.value ? groupesCatalogue(ressources.value) : [])

async function charger(): Promise<void> {
  if (chargement.value) return
  const reessai = statut.value === 'error'
  const boutonAvaitLeFocus = reessai && document.activeElement === boutonReessai.value
  chargement.value = true
  succesReessai.value = false
  try {
    ressources.value = await chargerRessourcesCatalogueIndicateurs()
    statut.value = 'ready'
    if (reessai) {
      succesReessai.value = true
      await nextTick()
      if (boutonAvaitLeFocus &&
          (document.activeElement === document.body || document.activeElement === document.documentElement)) {
        statutSuccesReessai.value?.focus()
      }
    }
  } catch {
    statut.value = 'error'
  } finally {
    chargement.value = false
  }
}

onMounted(() => { void charger() })
</script>

<template>
  <section class="catalogue" :aria-busy="chargement || statut === 'loading' ? 'true' : 'false'">
    <header class="catalogue-entete">
      <h1>Indicateurs</h1>
      <p class="catalogue-sous-titre">
        Chaque indicateur publié, lu à travers tous les territoires comparables —
        groupé par thème, tel qu'il apparaît sur les fiches.
      </p>
    </header>

    <p v-if="statut === 'loading'" class="catalogue-etat" role="status">
      Chargement du catalogue des indicateurs…
    </p>
    <div v-else-if="statut === 'error'" class="catalogue-etat">
      <p v-if="chargement" role="status" aria-live="polite">Chargement du catalogue des indicateurs…</p>
      <p v-else role="alert">Le catalogue des indicateurs est indisponible.</p>
      <button
        ref="boutonReessai"
        type="button"
        class="catalogue-retry"
        :aria-disabled="chargement ? 'true' : 'false'"
        @click="charger"
      >
        Réessayer
      </button>
    </div>
    <p
      v-if="succesReessai"
      ref="statutSuccesReessai"
      class="catalogue-etat"
      role="status"
      aria-live="polite"
      tabindex="-1"
      data-testid="catalogue-retry-success"
    >
      Le catalogue des indicateurs est de nouveau disponible.
    </p>
    <template v-if="statut === 'ready'">
      <section
        v-for="groupe in groupes"
        :key="groupe.theme"
        class="catalogue-theme"
        :data-groupe-theme="groupe.theme"
        :class="`catalogue-theme--${groupe.theme}`"
      >
        <h2>{{ groupe.label }}</h2>
        <div
          v-for="sousGroupe in groupe.sousGroupes"
          :key="sousGroupe.key"
          class="catalogue-sous-groupe"
        >
          <h3 data-groupe-sous-groupe :data-clef-sous-groupe="sousGroupe.key">{{ sousGroupe.label }}</h3>
          <ul class="catalogue-liste">
            <li v-for="entree in sousGroupe.entrees" :key="entree.indicateur">
              <RouterLink :to="entree.href">{{ entree.label }}</RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.catalogue {
  flex: 1;
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-10) var(--grid-margin-mobile) var(--space-16);
  background: var(--surface-secondary);
}

.catalogue-entete {
  max-width: 760px;
  margin-bottom: var(--space-8);
}

.catalogue-etat {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--text-body);
  color: var(--text-primary);
}

.catalogue-etat p { margin: 0; }

.catalogue-retry {
  min-height: 36px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  cursor: pointer;
}

.catalogue h1 {
  margin: 0 0 var(--space-2);
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.catalogue-sous-titre {
  margin: 0;
  font: var(--text-body-lg);
  color: var(--text-secondary);
}

.catalogue-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6) 0;
  border-top: 1px solid var(--border-subtle);
}

.catalogue-theme:first-of-type {
  border-top: 0;
}

.catalogue-theme h2 {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-section-title);
}

/* La rampe du thème porte le titre — une variable posée par thème. */
.catalogue-theme--mobilite h2 { color: var(--theme-mobilite-strong); }
.catalogue-theme--demographie h2 { color: var(--theme-demographie-strong); }
.catalogue-theme--habitat h2 { color: var(--theme-habitat-strong); }
.catalogue-theme--economie h2 { color: var(--theme-economie-strong); }
.catalogue-theme--milieux h2 { color: var(--theme-milieux-strong); }
.catalogue-theme--programmes h2 { color: var(--theme-programmes-strong); }

.catalogue-sous-groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.catalogue-sous-groupe h3 {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.catalogue-liste {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-2) var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
}

.catalogue-liste a {
  display: inline-block;
  padding: var(--space-2) 0;
  font: var(--text-body);
  font-weight: 600;
  color: var(--text-primary);
}

.catalogue-liste a:hover {
  color: var(--accent-primary);
}
</style>
