<script setup lang="ts">
/**
 * IndicateursView — le catalogue /indicateurs (#409) : la liste CONTRACT-DRIVEN
 * des Pages d'indicateur publiées, groupée par thème canonique puis par
 * sous-groupe de fiche (l'ordre déclaré de theme_<theme>.json). Les thèmes et
 * les sous-groupes sont des rassemblements TITRÉS — jamais des liens ni des
 * pages analytiques (le catalogue mène uniquement aux Pages d'indicateur).
 *
 * Le wait-set (#296) : la table de référence + la métadonnée des SIX thèmes —
 * chaque theme_<theme>.json chaîne sur sa paire hermétique dans le magasin,
 * donc attendre la métadonnée attend implicitement les faits du thème. Les
 * libellés viennent des métadonnées publiées (descripteurs canon), jamais
 * d'une clé brute.
 */
import { computed } from 'vue'

import { groupesCatalogue } from '@/indicateurs/catalogue'
import { usePayload } from '@/payload/usePayload'
import type { Fichier } from '@/payload/loader'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Theme } from '@/payload/types'

const { payload, erreur, chargement } = usePayload({
  attendre: ['territoires', ...THEMES_CANONIQUES.map((theme) => `theme_${theme}` as Fichier)],
})

const groupes = computed(() => groupesCatalogue(payload.value.themeMetadata ?? {}))

const themeDe = (theme: string): Theme => theme as Theme
</script>

<template>
  <section class="catalogue" :aria-busy="chargement ? 'true' : 'false'">
    <header class="catalogue-entete">
      <h1>Indicateurs</h1>
      <p class="catalogue-sous-titre">
        Chaque indicateur publié, lu à travers tous les territoires comparables —
        groupé par thème, tel qu'il apparaît sur les fiches.
      </p>
    </header>

    <div v-if="chargement" role="status" aria-label="Chargement du catalogue">
      <div class="squelette squelette--ligne" />
      <div class="squelette squelette--ligne" />
    </div>
    <div v-else-if="erreur" role="alert">Impossible de charger le catalogue.</div>
    <div v-else-if="groupes.length === 0" role="note">Aucun indicateur publié pour l’instant.</div>

    <template v-else>
      <section
        v-for="groupe in groupes"
        :key="groupe.theme"
        class="catalogue-theme"
        :data-groupe-theme="themeDe(groupe.theme)"
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
  font: 600 1.5rem/1.3 var(--font-serif);
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
