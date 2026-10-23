<script setup lang="ts">
/**
 * Catalogue /indicateurs (#409), servi par le contenu éditorial stable de
 * l'application : cette navigation ne dépend ni des métadonnées de thème ni
 * des faits disponibles à l'exécution.
 */
import { groupesCatalogue } from '@/indicateurs/catalogue'

const groupes = groupesCatalogue()
</script>

<template>
  <section class="catalogue" aria-busy="false">
    <header class="catalogue-entete">
      <h1>Indicateurs</h1>
      <p class="catalogue-sous-titre">
        Chaque indicateur publié, lu à travers tous les territoires comparables —
        groupé par thème, tel qu'il apparaît sur les fiches.
      </p>
    </header>

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
